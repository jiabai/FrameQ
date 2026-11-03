from __future__ import annotations

import hashlib
import os
import stat
from dataclasses import dataclass
from pathlib import Path
from typing import Literal


@dataclass(frozen=True)
class SourceText:
    kind: Literal["article", "transcript"]
    artifact_key: str
    path: Path
    raw_bytes: bytes
    text: str
    sha256: str


def read_source_text(output_root: Path, task_id: str) -> SourceText:
    from frameq_worker.task_store import load_task_manifest

    manifest = load_task_manifest(output_root, task_id)
    article = manifest.get("source_kind") == "web_page"
    relative = "article/article.txt" if article else "transcript/transcript.txt"
    key = "article_txt" if article else "transcript_txt"
    if manifest.get("artifacts", {}).get(key) != relative:
        raise ValueError("Authoritative source text is missing.")
    path = output_root / "tasks" / task_id / relative
    raw = read_source_file(path, 2 * 1024 * 1024 if article else 32 * 1024 * 1024)
    text = raw.decode("utf-8")
    if not text.strip():
        raise ValueError("Authoritative source text is empty.")
    return SourceText("article" if article else "transcript", key, path, raw, text,
                      hashlib.sha256(raw).hexdigest())


def read_source_file(path: Path, maximum_bytes: int) -> bytes:
    is_junction = getattr(os.path, "isjunction", lambda _path: False)
    parent_identities = {}
    for parent in (path, *path.parents):
        if parent.is_symlink() or is_junction(parent):
            raise ValueError("Source storage is linked.")
        if parent != path:
            identity = parent.stat(follow_symlinks=False)
            parent_identities[parent] = (identity.st_dev, identity.st_ino)
    before = path.stat(follow_symlinks=False)
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > maximum_bytes:
        raise ValueError("Source storage is invalid.")
    descriptor = os.open(
        path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0),
    )
    with os.fdopen(descriptor, "rb") as stream:
        opened = os.fstat(stream.fileno())
        if (before.st_dev, before.st_ino) != (opened.st_dev, opened.st_ino) or opened.st_nlink != 1:
            raise ValueError("Source storage changed.")
        raw = stream.read(maximum_bytes + 1)
        after = os.fstat(stream.fileno())
        current = path.stat(follow_symlinks=False)
        if (len(raw) > maximum_bytes or len(raw) != after.st_size or after.st_nlink != 1
                or (before.st_dev, before.st_ino, before.st_mtime_ns, before.st_size)
                != (after.st_dev, after.st_ino, after.st_mtime_ns, after.st_size)
                or (current.st_dev, current.st_ino) != (after.st_dev, after.st_ino)):
            raise ValueError("Source storage changed.")
        for parent, expected in parent_identities.items():
            current_parent = parent.stat(follow_symlinks=False)
            if (parent.is_symlink() or is_junction(parent)
                    or (current_parent.st_dev, current_parent.st_ino) != expected):
                raise ValueError("Source parent storage changed.")
    return raw
