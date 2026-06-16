from __future__ import annotations

import os
from collections.abc import Mapping
from pathlib import Path

DOTENV_FILE_NAME = ".env"


def load_project_env(
    project_root: Path,
    environ: Mapping[str, str] | None = None,
) -> dict[str, str]:
    base_env = dict(environ if environ is not None else os.environ)
    dotenv_env = parse_dotenv(project_root / DOTENV_FILE_NAME)
    merged_env = {**dotenv_env, **base_env}
    return {key: value for key, value in merged_env.items() if value != ""}


def parse_dotenv(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}

    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        if line.startswith("export "):
            line = line.removeprefix("export ").strip()

        key, value = line.split("=", 1)
        key = key.strip()
        if not key:
            continue

        values[key] = strip_env_value(value.strip())

    return values


def strip_env_value(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        return value[1:-1]

    return value
