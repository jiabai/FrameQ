# Desktop One-Click Updates ExecPlan

## Goal

Implement low-noise one-click updates for the FrameQ desktop app using Tauri updater and GitHub Releases hosted updater metadata/artifacts, while keeping the Python worker bundled with the app release.

## Decisions

- Use Tauri updater signed artifacts and process relaunch support.
- Use GitHub Releases `latest.json` as the stable update source for v1; keep the server dynamic route as a future optional layer.
- Keep worker updates coupled to app updates; do not introduce app-local executable replacement.
- Store only update preferences/status metadata in app-local data; never store user content or release signing secrets there.
- Block installation while worker processing or ASR model download is active.

## Implementation Tasks

- Add product, architecture, design, security, and task documentation for the update boundary.
- Add GitHub Releases release automation that uploads Tauri updater artifacts and `latest.json`.
- Add app state/client tests for update checking, progress, postponed/blocked install, and relaunch readiness.
- Add Tauri updater/process dependencies, config, capability permissions, and release artifact settings.
- Add React toolbar/settings UI for checking, installing, progress, errors, and restart.
- Update release documentation/tests so update artifacts are generated without bundling ASR models.

## Progress

- [x] Product spec and ExecPlan created.
- [x] GitHub Releases updater endpoint configured.
- [x] Tauri updater/process config implemented.
- [x] Desktop update UI implemented.
- [x] Automated verification completed.
- [x] Release workflow normalizes `latest.json` to UTF-8 without BOM before final upload.
- [x] Bundled updater endpoint includes a fixed query string to avoid stale GitHub release-asset cache entries after an in-place manifest repair.
- [ ] Clean-machine signed update validation completed — blocked by production signing key and clean VM availability.

## Validation

- `npm --prefix server test`
- `npm --prefix server run build`
- `npm --prefix app test`
- `npm --prefix app run build`
- `cargo test --manifest-path app/src-tauri/Cargo.toml`
- `python scripts/validate_agents_docs.py --level WARN`

## Remaining External Release Checks

The following items require production signing keys (private key in release secret storage, production public key in `tauri.conf.json`) and clean Windows/macOS VM environments. These are blocking the final release gate but are not code-blocked:

- [ ] Replace the development updater public key in `tauri.conf.json` with the production updater public key generated outside the repository, and keep the private key/password in release secret storage only.
- [ ] Build signed Windows and macOS update artifacts.
- [ ] Upload artifacts, signatures, and `latest.json` to GitHub Releases.
- [ ] Verify old-version to new-version update on clean Windows/macOS machines.

## Validation Results

2026-06-23 automated gates passed:

- `npm --prefix server test`
- `npm --prefix server run build`
- `npm --prefix app test`
- `npm --prefix app run build`
- `cargo test --manifest-path app\src-tauri\Cargo.toml`
- `npm --prefix app run tauri -- build --no-bundle`
- `uv run ruff check worker`
- `uv run pytest worker\tests`
- `python scripts\validate_agents_docs.py --level WARN`

2026-06-25 updater manifest encoding fix:

- `npm --prefix app test -- tests/updater-manifest-release.test.ts`
