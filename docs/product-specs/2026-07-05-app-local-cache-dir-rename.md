# App-Local Cache Directory Rename

## Intent

FrameQ's app-local temporary task area should be named `cache/` because it stores rebuildable downloads, merge scratch files, partial media, and diagnostics rather than durable user-facing output.

## Scope

- New desktop runs create app-local `cache/` and pass it to the Python worker through `FRAMEQ_CACHE_DIR`.
- The legacy desktop-worker temporary-dir contract is retired without compatibility fallback.
- User-visible final artifacts remain under `<FRAMEQ_OUTPUT_DIR>/tasks/<task_id>/`.
- Existing legacy temporary contents are not migrated or read as task history; the task manifest under the configured output root remains the source of truth.
- Existing legacy app-local temporary directories are removed during runtime directory setup.

## Acceptance Criteria

- Tauri runtime directory setup creates app-local `cache/`.
- Tauri runtime directory setup removes the legacy app-local temporary directory if it exists.
- Worker process command construction sets `FRAMEQ_CACHE_DIR=<app-local>/cache` and does not set any legacy temporary-dir env.
- Worker default cache resolution falls back to `<project_root>/cache` when no cache env is supplied.
- Task download scratch files are written under `<cache_root>/tasks/<task_id>/download`.
- Documentation refers to app-local `cache/` for temporary task files and keeps `outputs/` as the user artifact root.
