# Installer Distribution Runtime ExecPlan

## Goal

Make FrameQ installable for ordinary Windows and macOS users without requiring Python, uv, ffmpeg, yt-dlp, repo layout, or manual environment variables.

## Decisions

- Do not bundle SenseVoice Small in the ordinary-user installer; expose it as the only release ASR model and download it on first run.
- Keep Qwen adapter code but hide Qwen from release UI until separately packaged and verified.
- Use Tauri resource directory for read-only bundled runtime files.
- Use Tauri app-local data directory for `.env`, `outputs`, `work`, `history.json`, and writable model/cache data.
- Build unsigned internal installer packages first; public release signing/notarization remains a release gate.
- Installer builds do not require model resources; first-run model status must check app-local data for `MODEL_VERSION.txt`, SenseVoice `model.pt`, and VAD `model.pt`.
- Default model download source is ModelScope; release operators may configure `FRAMEQ_ASR_MODEL_DOWNLOAD_URL` and `FRAMEQ_ASR_MODEL_DOWNLOAD_SHA256` for a custom archive.
- The default ordinary-user installer dependency set excludes Qwen-only packages; `qwen-asr` remains an optional development extra while release builds explicitly install SenseVoice/FunASR runtime dependencies, including `torch`.
- Windows NSIS packaging requires pruning non-runtime Python artifacts so the bundled resources stay under practical NSIS size limits.

## Implementation Tasks

- Update governance and product specs for lightweight installer plus first-run ASR model download.
- Add tests for release runtime command construction, app-local config/history paths, worker work/output env behavior, and release-visible ASR model list.
- Replace Rust repo-root/`uv` worker spawning with bundled Python/resource-dir spawning.
- Redirect config, history, outputs, work, and model cache to app-local data.
- Add first-run command/UI paths for local ASR model readiness and account/server LLM readiness guidance; desktop `.env` must not collect LLM configuration.
- Add build-installer scripts and Tauri resource packaging entries for Windows and macOS.
- Harden installer packaging so model resources are excluded from ordinary-user resources and macOS arm64/x64 use explicit target triples.
- Add Tauri commands and UI for ASR model status, download progress, cancellation, and missing-model recovery.
- Trim release Python dependencies, prune non-runtime runtime artifacts, and make external build command failures fail the installer script.
- Run automated gates and document packaging checks that require clean Windows/macOS machines.

## Progress

- [x] Governance/spec/ExecPlan created.
- [x] Release runtime tests added.
- [x] Rust runtime implementation updated.
- [x] Worker directory/env behavior updated.
- [x] UI first-run and ASR visibility updated.
- [x] Installer resource scripts/config added.
- [x] Release hardening added for model availability checks, explicit macOS targets, and non-scaffold app metadata.
- [x] Windows release runtime trimmed to SenseVoice default dependencies, Qwen optional extra, explicit torch dependency, and pruned Python runtime artifacts.
- [x] Previous full Windows x64 NSIS installer produced locally with real bundled runtime/model assets before the lightweight first-run-download direction replaced bundled-model distribution.
- [x] Lightweight installer direction implemented: `resources/models` removed, first-run ASR model download command/UI added, and worker returns `ASR_MODEL_NOT_DOWNLOADED` when the cache is absent.
- [x] Automated verification completed.
- [ ] Clean Windows/macOS install-machine packaging validation completed — blocked by clean VM environments and production signing/notarization credentials.

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
- Node syntax check for `scripts/build-installer.mjs`
- `npm --prefix app run tauri -- build --no-bundle`

2026-06-18 release hardening gates passed:

- `cargo test --manifest-path app\src-tauri\Cargo.toml asr_model_availability -- --nocapture`
- `npm --prefix app test -- tests/tauri-window-config.test.ts`
- `uv run ruff check worker`
- `uv run pytest worker\tests`
- `npm --prefix app test`
- `npm --prefix app run build`
- `cargo test --manifest-path app\src-tauri\Cargo.toml`
- `npm --prefix app run tauri -- build --no-bundle`
- `python scripts/validate_agents_docs.py --level WARN`
- Node syntax check for `scripts/build-installer.mjs`

Remaining external release checks require real Python standalone archives, ffmpeg/ffprobe archives, target Windows/macOS machines, network access for first-run model download, and signing/notarization credentials.

2026-06-19 Windows x64 full-bundle packaging smoke before lightweight direction:

- Used Python standalone `cpython-3.12.13+20260610-x86_64-pc-windows-msvc-install_only.tar.gz`, gyan.dev `ffmpeg-release-essentials.zip`, and local SenseVoice Small cache `D:\Github\FrameQ\models\models\iic\SenseVoiceSmall`.
- `node scripts\build-installer.mjs --target windows-x64 --skip-tauri-build` prepared bundled resources and passed the Python runtime smoke test.
- Bundled resources were reduced from 2.68GB to 1.95GB by excluding Qwen-only packages and pruning non-runtime Python artifacts.
- Verified bundled Python imports `torch`, `funasr`, `modelscope`, `yt_dlp`, and `frameq_worker`; verified `qwen_asr` is not bundled by default.
- `npm --prefix app run tauri -- build --target x86_64-pc-windows-msvc` produced `app/src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/FrameQ_0.1.0_x64-setup.exe` at 1055.5MB.

Superseded release checks: this full-bundle installer path is no longer the ordinary-user distribution target after switching to first-run model download. Clean-machine validation must use the lightweight runtime package.

2026-06-19 lightweight first-run model download implementation:

- Removed `resources/models` from Tauri bundle resources and from `scripts/build-installer.mjs`.

2026-06-30 packaging shell dependency cleanup:

- Replaced the legacy PowerShell installer script with `scripts/build-installer.mjs` so local installer packaging and GitHub release resource preparation no longer require PowerShell Core or Windows PowerShell.
- Updated `.github/workflows/desktop-release.yml` to run the installer resource step and updater manifest normalization under `cmd`.
- Added worker ASR model downloader using ModelScope by default and optional custom archive URL/SHA env vars.
- Added Tauri `download_asr_model` / `cancel_asr_model_download` commands and `asr-model-download-progress` event forwarding.
- Added first-run UI path for missing SenseVoice Small cache; settings can also restart the model download.
- Added worker `ASR_MODEL_NOT_DOWNLOADED` error after video/audio extraction when the ASR cache is absent.

2026-06-30 macOS x64 local installer packaging:

- Built macOS x64 resources from CPython standalone `3.12.13` and local ffmpeg/ffprobe x86_64 archive without bundling `resources/models`.
- Fixed installer resource preparation so missing archive inputs fail before resetting resources, `--skip-downloads` does not clear existing resources, and macOS Python standalone launchers are normalized to package-local `python3.12` instead of absolute build-directory symlinks.
- Fixed packaged worker YouTube extraction by invoking `yt_dlp` through the bundled interpreter with `python -m yt_dlp` instead of relying on an external `yt-dlp` command on `PATH`.
- Rebuilt the local macOS x64 DMG after the result workspace layout fix so result tiles stay inside the results panel.
- Added macOS x64 dependency markers for `torch==2.2.2`, `torchaudio==2.2.2`, and `numpy<2`; this avoids unavailable newer Intel macOS PyTorch wheels and the NumPy 2 ABI warning with torch 2.2.2 on Python 3.12.
- Produced local DMG `app/src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/FrameQ_0.2.11_x64.dmg` at 369MB with SHA256 `c22abc1b598cdb8e1f6d5d62e96a1bfe8f0d93a470b7532d9abf7d587bd66239`.
- Verified `hdiutil verify` succeeds; mounted the DMG read-only and confirmed app, Python 3.12.13, ffmpeg, and ffprobe are x86_64.
- Verified package-local Python imports `numpy 1.26.4`, `torch 2.2.2`, `torchaudio 2.2.2`, `funasr`, `modelscope`, `yt_dlp`, and `frameq_worker` directly from the mounted DMG; also verified mounted `python -m yt_dlp --version` returns `2026.06.09`.
- Verified the mounted DMG has no `resources/models` directory and no bundled `__pycache__` files.
- Local DMG remains unsigned and not notarized; clean-machine install and first-run model download validation remain open release gates.
