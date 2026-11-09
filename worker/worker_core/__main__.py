"""FrameQ worker package entry point."""

from worker_core.import_stage_diagnostics import emit_import_stage_diagnostic

try:
    from worker_core.cli import main
except BaseException as exc:  # noqa: BLE001 - import-stage diagnostic guard
    emit_import_stage_diagnostic(exc)
    raise

raise SystemExit(main())
