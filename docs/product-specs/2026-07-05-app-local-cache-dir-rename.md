# Task Cache Directory

## Intent

FrameQ's temporary task area is named `cache/` and belongs to the current data root. It stores rebuildable downloads, merge scratch files, partial media and task diagnostics separately from durable user-facing output. Data location and recoverable migration follow [Data storage location](2026-11-01-data-storage-location.md).

## Scope

- Desktop data operations resolve the current location snapshot, acquire the native data permit and pass its `cache/` to the Python worker through `FRAMEQ_CACHE_DIR`.
- The legacy desktop-worker temporary-dir contract is retired without compatibility fallback.
- User-visible final artifacts remain under the snapshot's `<output_root>/tasks/<task_id>/`; Managed mode uses `<data_root>/outputs/`.
- Rebuildable transcript audio playback copies live under `<data_root>/cache/.frameq-audio-review/<task_id>/`.
- Cache contents do not become task-history authorities. Explicit data migration preserves the complete application-owned cache tree; startup does not delete legacy temporary directories or treat their contents as current tasks.
- Credentials, `.env`, preferences, application logs and the storage-control record remain in the fixed system configuration root.

## Acceptance Criteria

- Tauri creates `cache/` under the verified current data root only when a permitted data operation requires runtime directories.
- Startup with invalid/offline storage does not create a replacement default data tree or remove legacy directories.
- Worker construction sets `FRAMEQ_CACHE_DIR=<data_root>/cache` from the same snapshot as output, model and runtime-component paths and does not set any legacy temporary-dir environment variable.
- Worker default cache resolution falls back to `<project_root>/cache` when no cache env is supplied.
- Task download scratch files are written under `<cache_root>/tasks/<task_id>/download`.
- Transcript review playback copies are created and cleared only under the current `cache/.frameq-audio-review` subtree with a native data permit.
- Migration preserves cache bytes and task relationships. Restart reloads paths from the verified new root; manual playback-cache cleanup protects original task files and other application data.
