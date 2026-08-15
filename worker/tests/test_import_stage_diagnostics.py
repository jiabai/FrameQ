from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import frameq_worker.cli as cli
import pytest
from frameq_worker.desktop_contract import (
    DIAGNOSTIC_EVENT_PREFIX as CONTRACT_DIAGNOSTIC_EVENT_PREFIX,
)
from frameq_worker.diagnostic_events import validate_diagnostic_event
from frameq_worker.import_stage_diagnostics import (
    DIAGNOSTIC_EVENT_PREFIX,
    emit_import_stage_diagnostic,
)


def parse_diagnostic_line(line: str) -> dict[str, object]:
    assert line.startswith("FRAMEQ_DIAGNOSTIC ")
    return json.loads(line[len("FRAMEQ_DIAGNOSTIC ") :])


def test_emit_import_stage_diagnostic_writes_one_closed_event(
    capsys: pytest.CaptureFixture[str],
) -> None:
    emit_import_stage_diagnostic(RuntimeError("secret message https://private.example/path"))

    captured = capsys.readouterr()
    diagnostic_lines = [
        line for line in captured.err.splitlines() if line.startswith("FRAMEQ_DIAGNOSTIC ")
    ]
    assert len(diagnostic_lines) == 1
    validated = validate_diagnostic_event(parse_diagnostic_line(diagnostic_lines[0]))
    assert validated["version"] == 1
    assert validated["operation"] == "download_asr_model"
    assert validated["phase"] == "preparing"
    assert validated["category"] == "dependency"
    assert validated["code"] == "dependency_unavailable"
    assert validated["exception_type"] == "RuntimeError"
    # Exception message text, URLs, and paths must never leak.
    assert "secret" not in captured.err
    assert "https://" not in captured.err


def test_main_guard_prefix_stays_in_sync_with_contract() -> None:
    assert DIAGNOSTIC_EVENT_PREFIX == CONTRACT_DIAGNOSTIC_EVENT_PREFIX


def test_cli_main_guard_emits_diagnostic_and_reraises(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    def boom(_argv=None) -> int:
        raise RuntimeError("boom secret")

    monkeypatch.setattr(cli, "_main_inner", boom)

    with pytest.raises(RuntimeError):
        cli.main([])

    captured = capsys.readouterr()
    diagnostic_lines = [
        line for line in captured.err.splitlines() if line.startswith("FRAMEQ_DIAGNOSTIC ")
    ]
    assert len(diagnostic_lines) == 1
    validated = validate_diagnostic_event(parse_diagnostic_line(diagnostic_lines[0]))
    assert validated["operation"] == "download_asr_model"
    assert validated["phase"] == "preparing"
    # A bare RuntimeError is not a recognized dependency failure; the
    # classifier falls back to the closed unexpected category.
    assert validated["category"] == "unexpected"
    assert validated["code"] == "unexpected_failure"
    assert validated["exception_type"] == "RuntimeError"
    assert "boom secret" not in captured.err


def test_cli_main_guard_passes_system_exit_through_without_diagnostic(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    def bye(_argv=None) -> int:
        raise SystemExit(0)

    monkeypatch.setattr(cli, "_main_inner", bye)

    with pytest.raises(SystemExit):
        cli.main([])

    assert capsys.readouterr().err == ""


def test_import_stage_guard_emits_event_when_cli_import_fails(tmp_path: Path) -> None:
    fake_package_root = tmp_path / "fake"
    fake_package = fake_package_root / "frameq_worker"
    fake_package.mkdir(parents=True)
    (fake_package / "__init__.py").write_text("", encoding="utf-8")
    # The entry point imports the stdlib-only diagnostic emitter before
    # importing cli; mirror the real module so the guard itself runs.
    real_import_stage = Path(cli.__file__).parent / "import_stage_diagnostics.py"
    (fake_package / "import_stage_diagnostics.py").write_text(
        real_import_stage.read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    (fake_package / "cli.py").write_text(
        "raise RuntimeError('simulated import failure')\n",
        encoding="utf-8",
    )

    main_py = Path(cli.__file__).parent / "__main__.py"
    script = (
        "import runpy, sys; "
        f"sys.path.insert(0, {str(fake_package_root)!r}); "
        f"runpy.run_path({str(main_py)!r}, run_name='__main__')"
    )
    proc = subprocess.run(
        [sys.executable, "-c", script],
        capture_output=True,
        text=True,
        timeout=30,
    )

    assert proc.returncode != 0
    diagnostic_lines = [
        line for line in proc.stderr.splitlines() if line.startswith("FRAMEQ_DIAGNOSTIC ")
    ]
    assert len(diagnostic_lines) == 1
    validated = validate_diagnostic_event(parse_diagnostic_line(diagnostic_lines[0]))
    assert validated["operation"] == "download_asr_model"
    assert validated["phase"] == "preparing"
    assert validated["category"] == "dependency"
    assert validated["code"] == "dependency_unavailable"
    assert validated["exception_type"] == "RuntimeError"
    # The raw exception message must not appear in the diagnostic line.
    assert "simulated" not in diagnostic_lines[0]
