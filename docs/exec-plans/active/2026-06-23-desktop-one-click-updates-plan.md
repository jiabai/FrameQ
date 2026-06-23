# Desktop One-Click Updates ExecPlan

## Goal

Implement low-noise one-click updates for the FrameQ desktop app using Tauri updater and a FrameQ server dynamic manifest endpoint, while keeping the Python worker bundled with the app release.

## Decisions

- Use Tauri updater signed artifacts and process relaunch support.
- Use FrameQ server as the dynamic update source for the stable channel.
- Keep worker updates coupled to app updates; do not introduce app-local executable replacement.
- Store only update preferences/status metadata in app-local data; never store user content or release signing secrets there.
- Block installation while worker processing or ASR model download is active.

## Implementation Tasks

- Add product, architecture, design, security, and task documentation for the update boundary.
- Add server tests and implement `GET /api/desktop/updates/:target/:arch/:currentVersion`.
- Add app state/client tests for update checking, progress, postponed/blocked install, and relaunch readiness.
- Add Tauri updater/process dependencies, config, capability permissions, and release artifact settings.
- Add React toolbar/settings UI for checking, installing, progress, errors, and restart.
- Update release documentation/tests so update artifacts are generated without bundling ASR models.

## Progress

- [x] Product spec and ExecPlan created.
- [x] Server update manifest route implemented.
- [x] Tauri updater/process config implemented.
- [x] Desktop update UI implemented.
- [x] Automated verification completed.
- [ ] Clean-machine signed update validation completed.

## Validation

- `npm --prefix server test`
- `npm --prefix server run build`
- `npm --prefix app test`
- `npm --prefix app run build`
- `cargo test --manifest-path app/src-tauri/Cargo.toml`
- `python scripts/validate_agents_docs.py --level WARN`

## Remaining External Release Checks

- Replace the development updater public key in `tauri.conf.json` with the production updater public key generated outside the repository, and keep the private key/password in release secret storage only.
- Build signed Windows and macOS update artifacts.
- Upload artifacts and `.sig` contents to HTTPS release storage.
- Verify old-version to new-version update on clean Windows/macOS machines.

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
