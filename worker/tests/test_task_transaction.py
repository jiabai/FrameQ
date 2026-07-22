from __future__ import annotations

import json
from pathlib import Path

import pytest
from frameq_worker import task_transaction
from frameq_worker.task_transaction import (
    JOURNAL_FILE_NAME,
    RecoveryOutcome,
    TaskArtifactCommitError,
    TaskArtifactRecoveryError,
    commit_task_artifacts,
    recover_task_artifacts,
)


class SimulatedCrash(BaseException):
    pass


def _task_dir(tmp_path: Path) -> Path:
    task_dir = tmp_path / "outputs" / "tasks" / "task-1"
    (task_dir / "transcript").mkdir(parents=True)
    (task_dir / "ai").mkdir()
    return task_dir


def _transaction_internal_files(task_dir: Path) -> list[Path]:
    return sorted(
        (
            path
            for path in task_dir.rglob(".frameq-*")
            if path.is_file()
        ),
        key=lambda path: path.as_posix(),
    )


def test_commit_replaces_complete_bundle_and_cleans_internal_files(tmp_path: Path) -> None:
    task_dir = _task_dir(tmp_path)
    txt_path = task_dir / "transcript" / "transcript.txt"
    md_path = task_dir / "transcript" / "transcript.md"
    manifest_path = task_dir / "frameq-task.json"
    txt_path.write_bytes(b"old text\n")
    md_path.write_bytes(b"# Old\n")
    manifest_path.write_bytes(b'{"status":"old"}\n')

    commit_task_artifacts(
        task_dir,
        {
            "transcript/transcript.txt": b"new text\n",
            "transcript/transcript.md": b"# New\n",
            "frameq-task.json": b'{"status":"new"}\n',
        },
    )

    assert txt_path.read_bytes() == b"new text\n"
    assert md_path.read_bytes() == b"# New\n"
    assert manifest_path.read_bytes() == b'{"status":"new"}\n'
    assert _transaction_internal_files(task_dir) == []


def test_precommit_crash_recovers_complete_previous_revision_idempotently(
    tmp_path: Path,
) -> None:
    task_dir = _task_dir(tmp_path)
    txt_path = task_dir / "transcript" / "transcript.txt"
    md_path = task_dir / "transcript" / "transcript.md"
    txt_path.write_bytes(b"old text\n")
    md_path.write_bytes(b"# Old\n")

    def crash_after_first_replace(event: str) -> None:
        if event == "after_replace:transcript/transcript.txt":
            raise SimulatedCrash()

    with pytest.raises(SimulatedCrash):
        commit_task_artifacts(
            task_dir,
            {
                "transcript/transcript.txt": b"new text\n",
                "transcript/transcript.md": b"# New\n",
            },
            _fault_hook=crash_after_first_replace,
        )

    assert (task_dir / JOURNAL_FILE_NAME).is_file()
    assert txt_path.read_bytes() == b"new text\n"
    assert md_path.read_bytes() == b"# Old\n"

    assert recover_task_artifacts(task_dir) is RecoveryOutcome.ROLLED_BACK
    assert txt_path.read_bytes() == b"old text\n"
    assert md_path.read_bytes() == b"# Old\n"
    assert recover_task_artifacts(task_dir) is RecoveryOutcome.NONE
    assert _transaction_internal_files(task_dir) == []


def test_postcommit_crash_keeps_complete_new_revision_and_cleans_idempotently(
    tmp_path: Path,
) -> None:
    task_dir = _task_dir(tmp_path)
    txt_path = task_dir / "transcript" / "transcript.txt"
    md_path = task_dir / "transcript" / "transcript.md"
    txt_path.write_bytes(b"old text\n")
    md_path.write_bytes(b"# Old\n")

    def crash_after_commit(event: str) -> None:
        if event == "after_journal_committed":
            raise SimulatedCrash()

    with pytest.raises(SimulatedCrash):
        commit_task_artifacts(
            task_dir,
            {
                "transcript/transcript.txt": b"new text\n",
                "transcript/transcript.md": b"# New\n",
            },
            _fault_hook=crash_after_commit,
        )

    assert txt_path.read_bytes() == b"new text\n"
    assert md_path.read_bytes() == b"# New\n"
    assert recover_task_artifacts(task_dir) is RecoveryOutcome.COMMITTED_CLEANED
    assert txt_path.read_bytes() == b"new text\n"
    assert md_path.read_bytes() == b"# New\n"
    assert recover_task_artifacts(task_dir) is RecoveryOutcome.NONE
    assert _transaction_internal_files(task_dir) == []


def test_precommit_recovery_restores_deleted_destination(tmp_path: Path) -> None:
    task_dir = _task_dir(tmp_path)
    segments_path = task_dir / "transcript" / "segments.json"
    txt_path = task_dir / "transcript" / "transcript.txt"
    segments_path.write_bytes(b'{"segments":[{"id":"old"}]}\n')
    txt_path.write_bytes(b"old text\n")

    def crash_after_delete(event: str) -> None:
        if event == "after_replace:transcript/segments.json":
            raise SimulatedCrash()

    with pytest.raises(SimulatedCrash):
        commit_task_artifacts(
            task_dir,
            {
                "transcript/segments.json": None,
                "transcript/transcript.txt": b"new text\n",
            },
            _fault_hook=crash_after_delete,
        )

    assert not segments_path.exists()
    assert recover_task_artifacts(task_dir) is RecoveryOutcome.ROLLED_BACK
    assert segments_path.read_bytes() == b'{"segments":[{"id":"old"}]}\n'
    assert txt_path.read_bytes() == b"old text\n"


def test_commit_rejects_unsupported_destination_before_mutation(tmp_path: Path) -> None:
    task_dir = _task_dir(tmp_path)
    outside = tmp_path / "outside.txt"
    outside.write_bytes(b"outside\n")

    with pytest.raises(TaskArtifactCommitError) as captured:
        commit_task_artifacts(task_dir, {"../outside.txt": b"changed\n"})

    assert str(captured.value) == "Task artifacts could not be stored safely."
    assert captured.value.__cause__ is None
    assert outside.read_bytes() == b"outside\n"
    assert _transaction_internal_files(task_dir) == []


def test_invalid_journal_fails_closed_without_touching_authoritative_files(
    tmp_path: Path,
) -> None:
    task_dir = _task_dir(tmp_path)
    transcript_path = task_dir / "transcript" / "transcript.txt"
    transcript_path.write_bytes(b"mixed but untouched\n")
    outside = tmp_path / "outside.txt"
    outside.write_bytes(b"outside\n")
    (task_dir / JOURNAL_FILE_NAME).write_text(
        json.dumps(
            {
                "schema_version": 1,
                "transaction_id": "a" * 32,
                "state": "prepared",
                "entries": [
                    {
                        "destination": "../outside.txt",
                        "staging": ".frameq-artifact-"
                        + "a" * 32
                        + "-0.staging",
                        "rollback": None,
                        "existed_before": False,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(TaskArtifactRecoveryError) as captured:
        recover_task_artifacts(task_dir)

    assert str(captured.value) == "Task artifacts could not be recovered safely."
    assert captured.value.__cause__ is None
    assert transcript_path.read_bytes() == b"mixed but untouched\n"
    assert outside.read_bytes() == b"outside\n"
    assert (task_dir / JOURNAL_FILE_NAME).is_file()


def test_missing_prepared_rollback_fails_before_any_restore(tmp_path: Path) -> None:
    task_dir = _task_dir(tmp_path)
    txt_path = task_dir / "transcript" / "transcript.txt"
    md_path = task_dir / "transcript" / "transcript.md"
    txt_path.write_bytes(b"mixed new text\n")
    md_path.write_bytes(b"mixed new markdown\n")
    transaction_id = "b" * 32
    journal = {
        "schema_version": 1,
        "transaction_id": transaction_id,
        "state": "prepared",
        "entries": [
            {
                "destination": "transcript/transcript.txt",
                "staging": f"transcript/.frameq-artifact-{transaction_id}-0.staging",
                "rollback": f"transcript/.frameq-artifact-{transaction_id}-0.rollback",
                "existed_before": True,
            },
            {
                "destination": "transcript/transcript.md",
                "staging": f"transcript/.frameq-artifact-{transaction_id}-1.staging",
                "rollback": f"transcript/.frameq-artifact-{transaction_id}-1.rollback",
                "existed_before": True,
            },
        ],
    }
    (task_dir / JOURNAL_FILE_NAME).write_text(
        json.dumps(journal),
        encoding="utf-8",
    )
    (task_dir / "transcript" / f".frameq-artifact-{transaction_id}-0.rollback").write_bytes(
        b"old text\n"
    )

    with pytest.raises(TaskArtifactRecoveryError):
        recover_task_artifacts(task_dir)

    assert txt_path.read_bytes() == b"mixed new text\n"
    assert md_path.read_bytes() == b"mixed new markdown\n"


def test_recovery_removes_only_closed_name_orphans(tmp_path: Path) -> None:
    task_dir = _task_dir(tmp_path)
    orphan = (
        task_dir
        / "ai"
        / ".frameq-artifact-cccccccccccccccccccccccccccccccc-0.staging"
    )
    unrelated = task_dir / "ai" / ".frameq-user-note.staging"
    orphan.write_bytes(b"orphan")
    unrelated.write_bytes(b"keep")

    assert recover_task_artifacts(task_dir) is RecoveryOutcome.NONE

    assert not orphan.exists()
    assert unrelated.read_bytes() == b"keep"


def test_contract_fixtures_match_python_parser() -> None:
    repository_root = Path(__file__).resolve().parents[2]
    contract = json.loads(
        (repository_root / "contracts" / "task-artifact-transaction-v1.json").read_text(
            encoding="utf-8"
        )
    )

    for fixture in contract["validFixtures"]:
        task_transaction._parse_journal_payload(fixture)
    for fixture in contract["invalidFixtures"]:
        with pytest.raises(ValueError):
            task_transaction._parse_journal_payload(fixture["journal"])


def test_recovery_removes_closed_orphan_journal_staging(tmp_path: Path) -> None:
    task_dir = _task_dir(tmp_path)
    orphan = (
        task_dir
        / ".frameq-artifact-transaction.dddddddddddddddddddddddddddddddd.part.json"
    )
    orphan.write_bytes(b"incomplete journal")

    assert recover_task_artifacts(task_dir) is RecoveryOutcome.NONE

    assert not orphan.exists()
