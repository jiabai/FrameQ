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
- [x] Clean-machine GitHub updater validation waived by project decision on 2026-06-27 because GitHub Releases access from mainland China is too slow to test reliably. The feature is accepted based on automated gates, release artifact checks, and manual installer distribution fallback; live old-version-to-new-version GitHub download/install remains untested and is no longer a release blocker.

## Validation

- `npm --prefix server test`
- `npm --prefix server run build`
- `npm --prefix app test`
- `npm --prefix app run build`
- `cargo test --manifest-path app/src-tauri/Cargo.toml`
- `python scripts/validate_agents_docs.py --level WARN`

## Waived External Release Checks

The following live updater checks require reliable GitHub Releases access from the target machine. On 2026-06-27, the project accepted that mainland China access to GitHub Releases is too slow for stable manual verification, so these checks are waived for v1 and do not block release. This is a test-policy waiver, not evidence that the GitHub network path was successfully exercised in mainland China:

- [x] Replace the development updater public key in `tauri.conf.json` with the production updater public key generated outside the repository, and keep the private key/password in release secret storage only — release-management requirement remains, live GitHub updater smoke waived.
- [x] Build signed Windows and macOS update artifacts — release-management requirement remains, live GitHub updater smoke waived.
- [x] Upload artifacts, signatures, and `latest.json` to GitHub Releases — release-management requirement remains, live GitHub updater smoke waived.
- [x] Verify old-version to new-version update on clean Windows/macOS machines — waived for v1 due to mainland China GitHub Releases network constraints.

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

2026-06-27 updater live-test waiver:

- Mainland China access to GitHub Releases is too slow for reliable old-version-to-new-version updater testing.
- Project decision: stop treating the live GitHub updater smoke as a required test or release blocker.
- Accepted validation basis: existing automated tests, updater manifest/artifact generation checks, Tauri signature-verification configuration, and the ability to distribute fresh installers directly.
- Residual risk: users whose network cannot reach GitHub Releases quickly may still need to download and install a new installer manually.
