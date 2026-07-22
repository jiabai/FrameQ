from __future__ import annotations

import json
from pathlib import Path

import pytest
from frameq_worker import atomic_files


def test_atomic_write_text_replaces_existing_bytes(tmp_path: Path) -> None:
    destination = tmp_path / "artifact.txt"
    destination.write_bytes(b"previous\r\nbytes\n")

    atomic_files.atomic_write_text(destination, "新内容\nsecond line\n")

    assert destination.read_bytes() == "新内容\nsecond line\n".encode()
    assert not list(tmp_path.glob(".artifact.*"))


def test_atomic_write_bytes_creates_absent_destination(tmp_path: Path) -> None:
    destination = tmp_path / "artifact.bin"

    atomic_files.atomic_write_bytes(destination, b"\x00FrameQ\xff")

    assert destination.read_bytes() == b"\x00FrameQ\xff"
    assert not list(tmp_path.glob(".artifact.*"))


def test_atomic_write_json_preserves_pretty_utf8_bytes(tmp_path: Path) -> None:
    destination = tmp_path / "artifact.json"
    payload = {"schemaVersion": 1, "title": "原子持久化"}

    atomic_files.atomic_write_json(destination, payload)

    expected = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    assert destination.read_bytes() == expected.encode("utf-8")


def test_replace_failure_preserves_existing_destination_and_hides_path(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    destination = tmp_path / "artifact.txt"
    destination.write_text("previous\n", encoding="utf-8")

    def fail_replace(_source: Path, _destination: Path) -> None:
        raise OSError("D:/private/customer/transcript.txt is locked")

    monkeypatch.setattr(atomic_files.os, "replace", fail_replace)

    with pytest.raises(atomic_files.AtomicFileCommitError) as captured:
        atomic_files.atomic_write_text(destination, "next\n")

    assert str(captured.value) == "Atomic file commit failed."
    assert captured.value.__cause__ is None
    assert destination.read_text(encoding="utf-8") == "previous\n"
    assert not list(tmp_path.glob(".artifact.*"))


def test_failed_first_replace_leaves_no_authoritative_destination(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    destination = tmp_path / "artifact.txt"

    monkeypatch.setattr(
        atomic_files.os,
        "replace",
        lambda _source, _destination: (_ for _ in ()).throw(OSError("full disk")),
    )

    with pytest.raises(atomic_files.AtomicFileCommitError):
        atomic_files.atomic_write_text(destination, "next\n")

    assert not destination.exists()
    assert not list(tmp_path.glob(".artifact.*"))


def test_sync_failure_preserves_existing_destination(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    destination = tmp_path / "artifact.txt"
    destination.write_text("previous\n", encoding="utf-8")
    monkeypatch.setattr(
        atomic_files.os,
        "fsync",
        lambda _descriptor: (_ for _ in ()).throw(OSError("sync failed")),
    )

    with pytest.raises(atomic_files.AtomicFileCommitError):
        atomic_files.atomic_write_text(destination, "next\n")

    assert destination.read_text(encoding="utf-8") == "previous\n"
    assert not list(tmp_path.glob(".artifact.*"))


def test_staged_file_rejects_non_regular_content(tmp_path: Path) -> None:
    destination = tmp_path / "artifact.txt"

    with pytest.raises(atomic_files.AtomicFileCommitError):
        with atomic_files.staged_file(destination) as staging_path:
            staging_path.mkdir()

    assert not destination.exists()


def test_atomic_write_rejects_linked_destination_without_touching_target(
    tmp_path: Path,
) -> None:
    target = tmp_path / "target.txt"
    target.write_text("target\n", encoding="utf-8")
    destination = tmp_path / "artifact.txt"
    try:
        destination.symlink_to(target)
    except OSError as error:
        pytest.skip(f"file symlink unavailable: {error.__class__.__name__}")

    with pytest.raises(atomic_files.AtomicFileCommitError):
        atomic_files.atomic_write_text(destination, "next\n")

    assert destination.is_symlink()
    assert target.read_text(encoding="utf-8") == "target\n"


def test_atomic_write_rejects_linked_parent_without_writing_outside_boundary(
    tmp_path: Path,
) -> None:
    outside = tmp_path / "outside"
    outside.mkdir()
    linked_parent = tmp_path / "linked-parent"
    try:
        linked_parent.symlink_to(outside, target_is_directory=True)
    except OSError as error:
        pytest.skip(f"directory symlink unavailable: {error.__class__.__name__}")

    with pytest.raises(atomic_files.AtomicFileCommitError):
        atomic_files.atomic_write_text(linked_parent / "artifact.txt", "next\n")

    assert not (outside / "artifact.txt").exists()


def test_atomic_write_json_encoding_failure_is_sanitized(tmp_path: Path) -> None:
    destination = tmp_path / "artifact.json"

    with pytest.raises(atomic_files.AtomicFileCommitError) as captured:
        atomic_files.atomic_write_json(destination, {"unsupported": object()})

    assert str(captured.value) == "Atomic file commit failed."
    assert captured.value.__cause__ is None
    assert not destination.exists()


def test_validator_failure_is_sanitized_and_preserves_destination(
    tmp_path: Path,
) -> None:
    destination = tmp_path / "artifact.txt"
    destination.write_text("previous\n", encoding="utf-8")

    def reject(_path: Path) -> None:
        raise OSError("D:/private/customer/invalid.txt")

    with pytest.raises(atomic_files.AtomicFileCommitError) as captured:
        with atomic_files.staged_file(destination, validator=reject) as staging_path:
            staging_path.write_text("next\n", encoding="utf-8")

    assert str(captured.value) == "Atomic file commit failed."
    assert captured.value.__cause__ is None
    assert destination.read_text(encoding="utf-8") == "previous\n"


def test_directory_sync_failure_after_replace_is_best_effort(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    destination = tmp_path / "artifact.txt"
    original_fsync = atomic_files.os.fsync
    calls = 0

    def fail_second_sync(descriptor: int) -> None:
        nonlocal calls
        calls += 1
        if calls == 1:
            original_fsync(descriptor)
            return
        raise OSError("directory sync unsupported")

    monkeypatch.setattr(atomic_files.os, "fsync", fail_second_sync)

    atomic_files.atomic_write_text(destination, "committed\n")

    assert destination.read_text(encoding="utf-8") == "committed\n"


def test_cleanup_failure_does_not_mask_primary_replace_failure(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    destination = tmp_path / "artifact.txt"
    destination.write_text("previous\n", encoding="utf-8")
    original_unlink = Path.unlink

    def fail_staging_cleanup(path: Path, *args: object, **kwargs: object) -> None:
        if path.name.startswith(".artifact."):
            raise OSError("cleanup unavailable")
        original_unlink(path, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", fail_staging_cleanup)
    monkeypatch.setattr(
        atomic_files.os,
        "replace",
        lambda _source, _destination: (_ for _ in ()).throw(OSError("replace failed")),
    )

    with pytest.raises(atomic_files.AtomicFileCommitError) as captured:
        atomic_files.atomic_write_text(destination, "next\n")

    assert str(captured.value) == "Atomic file commit failed."
    assert destination.read_text(encoding="utf-8") == "previous\n"


def test_synced_staging_can_be_installed_after_all_payloads_are_ready(
    tmp_path: Path,
) -> None:
    destination = tmp_path / "artifact.txt"
    destination.write_text("previous\n", encoding="utf-8")
    staging = tmp_path / ".frameq-artifact-deadbeef-0.staging"

    atomic_files.write_synced_new_file(staging, b"next\n")
    assert destination.read_text(encoding="utf-8") == "previous\n"

    atomic_files.install_staged_file(staging, destination)

    assert destination.read_text(encoding="utf-8") == "next\n"
    assert not staging.exists()


def test_atomic_remove_file_removes_regular_file_and_tolerates_absence(
    tmp_path: Path,
) -> None:
    destination = tmp_path / "artifact.txt"
    destination.write_text("previous\n", encoding="utf-8")

    atomic_files.atomic_remove_file(destination)
    atomic_files.atomic_remove_file(destination)

    assert not destination.exists()


def test_install_staged_file_requires_same_directory(tmp_path: Path) -> None:
    destination = tmp_path / "official" / "artifact.txt"
    destination.parent.mkdir()
    staging = tmp_path / "staging" / ".artifact.staging"
    staging.parent.mkdir()
    staging.write_bytes(b"next\n")

    with pytest.raises(atomic_files.AtomicFileCommitError):
        atomic_files.install_staged_file(staging, destination)

    assert staging.read_bytes() == b"next\n"
    assert not destination.exists()
