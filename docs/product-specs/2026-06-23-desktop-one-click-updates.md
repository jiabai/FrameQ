# Desktop One-Click Updates

## Background

FrameQ already ships as a lightweight desktop installer with bundled runtime resources and first-run ASR model download. Ordinary users should be able to receive desktop client and worker fixes without manually finding a new installer.

## Goals

- The desktop client checks FrameQ server for app updates without requiring login.
- When a newer stable release exists, the toolbar and settings sheet show a low-noise update reminder.
- The user can download, install, and restart into the new release from the desktop app.
- Python worker code is upgraded together with the desktop application bundle; v1 does not support independent worker hot updates.
- App-local data remains untouched across upgrades, including `models/`, `outputs/`, `work/history.json`, `auth/session.json`, and app-local `.env`.

## User-visible Requirements

- Startup performs a delayed, silent update check; manual checking is available in Settings.
- If the app is already current, manual check reports that no update is available.
- If an update is available, the user sees version notes and an `一键升级` action.
- If video processing, insight generation, or ASR model download is active, installation is blocked with a message that the task should finish first.
- Download progress is visible; errors are recoverable and do not damage the current installation.
- After installation, the app offers `重启完成更新` and relaunches through Tauri process support.

## Distribution Requirements

- Updates use Tauri updater signed artifacts.
- FrameQ server exposes a public read-only dynamic update endpoint for stable releases.
- Release metadata contains version, publication date, platform-specific artifact URL, signature, and release notes.
- Large installer/update artifacts are served from HTTPS release storage or CDN; SQLite does not store package binaries.
- ASR model weights, LLM keys, cloud LLM models, and user-private settings must not be bundled into update artifacts beyond the existing lightweight runtime resources.

## Non-goals

- No independent worker hot-update package in v1.
- No downgrade support.
- No beta/canary channel in v1, though the server API may reserve a `channel` query parameter.
- No forced update gate in v1.

## Acceptance Criteria

- An old installed build can detect a newer stable update from FrameQ server, download it, install it, and relaunch.
- Current-version clients receive `204 No Content` from the update endpoint.
- Invalid release metadata, missing signatures, and platform mismatches are not published to clients.
- Existing ASR model cache, outputs, history, local settings, and desktop session survive the upgrade.
- Offline or server-failing checks show a recoverable error only when manually triggered and do not block local transcription.
