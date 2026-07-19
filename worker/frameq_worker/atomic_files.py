from __future__ import annotations

import os
import stat
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4


class AtomicFileCommitError(OSError):
    """A safe, path-free failure raised before a staged file is committed."""

    def __init__(self) -> None:
        super().__init__("Atomic file commit failed.")


@contextmanager
def staged_file(
    destination: Path,
    *,
    validator: Callable[[Path], None] | None = None,
) -> Iterator[Path]:
    """Yield a same-directory staging path and atomically install it on success."""

    try:
        destination.parent.mkdir(parents=True, exist_ok=True)
    except OSError:
        raise AtomicFileCommitError() from None
    staging_path = destination.with_name(
        f".{destination.stem}.{uuid4().hex}.part{destination.suffix}"
    )
    try:
        yield staging_path
        _sync_regular_file(staging_path)
        if validator is not None:
            validator(staging_path)
        try:
            os.replace(staging_path, destination)
        except OSError:
            raise AtomicFileCommitError() from None
        _sync_directory_best_effort(destination.parent)
    except AtomicFileCommitError:
        raise
    except OSError:
        raise AtomicFileCommitError() from None
    finally:
        try:
            staging_path.unlink(missing_ok=True)
        except OSError:
            pass


def atomic_write_text(destination: Path, content: str) -> None:
    with staged_file(destination) as staging_path:
        with staging_path.open("x", encoding="utf-8", newline="\n") as handle:
            handle.write(content)


def _sync_regular_file(path: Path) -> None:
    file_stat = path.lstat()
    if not stat.S_ISREG(file_stat.st_mode):
        raise AtomicFileCommitError()
    with path.open("r+b") as handle:
        os.fsync(handle.fileno())


def _sync_directory_best_effort(directory: Path) -> None:
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
    try:
        descriptor = os.open(directory, flags)
    except OSError:
        return
    try:
        os.fsync(descriptor)
    except OSError:
        pass
    finally:
        try:
            os.close(descriptor)
        except OSError:
            pass
