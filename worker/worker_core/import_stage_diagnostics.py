"""Import-stage diagnostic emission for the worker entry point.

Kept in a stdlib-only module so both ``worker_core.__main__`` and tests can
use it without importing the (possibly broken) worker_core package.
"""

from __future__ import annotations

import json
import sys

# Kept in sync with worker_core.desktop_contract.DIAGNOSTIC_EVENT_PREFIX.
# Hard-coded here so a module-import-stage crash can still emit one closed
# structured diagnostic event without importing the package.
DIAGNOSTIC_EVENT_PREFIX = "APP_DIAGNOSTIC "


def emit_import_stage_diagnostic(exception: BaseException) -> None:
    try:
        payload = json.dumps(
            {
                "version": 1,
                "operation": "download_asr_model",
                "phase": "preparing",
                "category": "dependency",
                "code": "dependency_unavailable",
                "exception_type": type(exception).__name__,
            },
            ensure_ascii=True,
            separators=(",", ":"),
        )
        print(f"{DIAGNOSTIC_EVENT_PREFIX}{payload}", file=sys.stderr, flush=True)
    except BaseException:
        pass
