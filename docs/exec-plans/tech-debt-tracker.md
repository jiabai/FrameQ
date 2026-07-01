# Tech Debt Tracker

Last updated: 2026-07-01

## High Priority

| Topic | Why it matters | Source | Removal Condition |
|------|----------------|--------|-------------------|
| None | No high-priority MVP debt remains after final validation | N/A | N/A |

## Accepted / Deferred

| Topic | Why it matters | Source | Removal Condition |
|------|----------------|--------|-------------------|
| macOS notarization deferred | macOS DMGs are ad-hoc signed only (`bundle.macOS.signingIdentity = "-"`, `hardenedRuntime = false`), so first launch still shows a one-time Gatekeeper prompt that users must bypass manually. Full removal needs a paid Apple Developer ID + notarization. Ad-hoc signing is the free mitigation that avoids the non-recoverable "app is damaged" failure. | `app/src-tauri/tauri.conf.json`, README "macOS install and Gatekeeper" | Desktop app shows commercial demand → buy Apple Developer Program, add Developer ID signing + `notarytool` notarization + stapling to the macOS release jobs. |
| macOS auto-update not wired | `latest.json` only carries Windows platform entries and the macOS jobs upload DMGs without `.app.tar.gz` updater artifacts, so the Tauri updater never offers macOS updates (safe no-op, not a crash). | `.github/workflows/desktop-release.yml`, `app/src-tauri/tauri.conf.json` | Either gate the updater UI off on macOS, or publish `.app.tar.gz` + `.sig` and merge `darwin-*` entries into `latest.json`. |

## Recently Closed

| Topic | Evidence | Closed |
|------|----------|--------|
| Historical InsightFlow LLM live smoke | Closed by the 2026-06-17 smoke, but the project-root `.env` path is now retired. Current live LLM validation must use FrameQ server Admin Web config plus server-managed checkout; desktop `.env` is limited to non-LLM local settings. | 2026-06-17 |

## Debt Handling Rules

- Add debt here when it spans more than one file or more than one task.
- Remove or downgrade debt when a change clearly addresses it.
- Link back to the plan, design doc, or code path that best explains the issue.
