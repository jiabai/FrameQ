import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

import pytest
from worker_core.source_text import read_source_text
from worker_core.task_store import TaskStoreFacade


def save_request() -> dict[str, object]:
    return {
        "contract_version": 2, "operation_id": str(uuid4()),
        "task_id": "20261102-123456-web-0123456789abcdef",
        "article": {
            "title": "公开文章🙂", "sourceUrl": "https://www.python.org/doc/?id=12",
            "text": "原始字节保留🙂。\r\n" * 20,
            "markdown": "## 正文\r\n\r\n" + "原始字节保留🙂。\r\n" * 20,
        },
    }


@pytest.mark.parametrize("arguments", [
    ["--save-web-page-stdin"],
    ["--save-web-page-stdin", "--web-operation-id", "not-a-uuid"],
    ["--web-operation-id", "00000000-0000-0000-0000-000000000001"],
])
def test_web_cli_requires_native_operation_identity(tmp_path: Path, arguments: list[str]) -> None:
    result = run_web_cli(tmp_path, arguments, {})
    assert result.returncode == 2
    assert b"--web-operation-id" in result.stderr


def test_web_cli_rejects_stdin_operation_mismatch_before_saving(tmp_path: Path) -> None:
    result = run_web_cli(tmp_path, [
        "--save-web-page-stdin", "--web-operation-id", str(uuid4()),
    ], save_request())
    assert result.returncode == 1
    assert json.loads(result.stdout)["error"]["code"] == "WORKER_STDIN_INVALID"
    assert not (tmp_path / "outputs").exists()


def test_web_cli_saves_reserved_task_and_preserves_unicode_crlf(tmp_path: Path) -> None:
    payload = save_request()
    result = run_save_cli(tmp_path, payload)
    assert result.returncode == 0, result.stderr
    terminal = json.loads(result.stdout)
    assert terminal["status"] == "completed"
    assert terminal["task_id"] == payload["task_id"]
    assert terminal["task_created"] is True
    store = TaskStoreFacade(tmp_path / "outputs", tmp_path / "cache")
    task = store.open(terminal["task_id"])
    raw = payload["article"]["text"].encode("utf-8")
    source = read_source_text(store.output_root, terminal["task_id"])
    assert source.raw_bytes == raw
    assert source.sha256 == hashlib.sha256(raw).hexdigest()
    markdown = task.context.paths.article_md_path.read_bytes()
    assert markdown.endswith(payload["article"]["markdown"].encode("utf-8"))
    assert markdown == terminal["markdown"].encode("utf-8")
    assert b"web.page.saving" in result.stderr
    assert b"web.page.loading" not in result.stderr
    assert not (tmp_path / "runtime").exists()


@pytest.mark.parametrize("change", [
    "unknown", "version", "missing", "task_path", "task_format", "article_unknown",
    "source", "title", "text_limit", "markdown_limit",
])
def test_web_cli_rejects_invalid_save_request_before_creating_task(
    tmp_path: Path, change: str,
) -> None:
    payload = save_request()
    if change == "unknown":
        payload["browser_endpoint"] = "secret-canary"
    elif change == "version":
        payload["contract_version"] = True
    elif change == "missing":
        del payload["task_id"]
    elif change == "task_path":
        payload["task_id"] = "../secret-canary"
    elif change == "task_format":
        payload["task_id"] = "safe-but-unreserved"
    elif change == "article_unknown":
        payload["article"]["extra"] = "secret-canary"
    elif change == "source":
        payload["article"]["sourceUrl"] += "&token=secret-canary"
    elif change == "title":
        payload["article"]["title"] = "x" * 513
    elif change == "text_limit":
        payload["article"]["text"] = "x" * (2 * 1024 * 1024 + 1)
    else:
        payload["article"]["markdown"] = "x" * (4 * 1024 * 1024 + 1)
    result = run_save_cli(tmp_path, payload)
    assert json.loads(result.stdout)["status"] == "failed", result.stderr
    assert b"secret-canary" not in result.stdout + result.stderr
    assert not (tmp_path / "outputs").exists()


def test_web_cli_exclusive_task_creation_preserves_published_files(tmp_path: Path) -> None:
    payload = save_request()
    first = run_save_cli(tmp_path, payload)
    assert json.loads(first.stdout)["status"] == "completed"
    task = tmp_path / "outputs" / "tasks" / payload["task_id"]
    before = {
        path.relative_to(task): path.read_bytes() for path in task.rglob("*") if path.is_file()
    }
    payload["article"]["text"] = "Changed body" * 20
    repeated = run_save_cli(tmp_path, payload)
    assert json.loads(repeated.stdout)["status"] == "failed"
    after = {
        path.relative_to(task): path.read_bytes() for path in task.rglob("*") if path.is_file()
    }
    assert after == before


def test_web_cli_accepts_escaped_maximum_raw_body_above_generic_stdin_limit(tmp_path: Path) -> None:
    payload = save_request()
    payload["article"]["text"] = "\x01" * (2 * 1024 * 1024)
    payload["article"]["markdown"] = "\x01" * (4 * 1024 * 1024 - 1024)
    encoded = json.dumps(payload).encode("utf-8")
    assert 35 * 1024 * 1024 < len(encoded) < 40 * 1024 * 1024
    result = run_save_cli(tmp_path, payload)
    terminal = json.loads(result.stdout)
    assert terminal["status"] == "completed", result.stderr
    assert terminal["text"] == payload["article"]["text"]
    assert len(result.stdout) < 40 * 1024 * 1024


def test_web_cli_rejects_encoded_request_above_web_limit(tmp_path: Path) -> None:
    payload = save_request()
    payload["article"]["markdown"] = "x" * (40 * 1024 * 1024)
    result = run_save_cli(tmp_path, payload)
    assert result.returncode == 1
    assert json.loads(result.stdout)["error"]["code"] == "WORKER_STDIN_INVALID"
    assert not (tmp_path / "outputs").exists()


def run_save_cli(root: Path, payload: dict[str, object]) -> subprocess.CompletedProcess[bytes]:
    return run_web_cli(root, [
        "--save-web-page-stdin", "--web-operation-id", payload["operation_id"],
    ], payload)


def run_web_cli(
    root: Path, arguments: list[str], payload: dict[str, object],
) -> subprocess.CompletedProcess[bytes]:
    environment = {
        name: os.environ[name] for name in ("SYSTEMROOT", "WINDIR", "SYSTEMDRIVE")
        if name in os.environ
    }
    environment.update({name: str(root) for name in (
        "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "TEMP", "TMP", "TMPDIR",
    )})
    environment.update({
        "PYTHONPATH": str(Path(__file__).resolve().parents[1]),
        "PYTHONUTF8": "1", "PYTHONDONTWRITEBYTECODE": "1", "PYTHONNOUSERSITE": "1",
        "APP_OUTPUT_DIR": str(root / "outputs"), "APP_CACHE_DIR": str(root / "cache"),
    })
    return subprocess.run([
        sys.executable, "-m", "worker_core", *arguments,
    ], input=json.dumps(payload).encode("utf-8"), capture_output=True, cwd=root,
        env=environment, timeout=60, check=False)
