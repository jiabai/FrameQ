import copy
import json
import re
from pathlib import Path, PurePosixPath

import pytest
from frameq_worker import task_transaction as transaction

CONTRACT_PATH = Path(__file__).parents[2] / "contracts" / "task-artifact-transaction-v1.json"


def _load_contract() -> dict:
    return json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))


def _internal_path(
    contract: dict, destination: str, transaction_id: str, index: int, kind: str
) -> str:
    name = contract["internalPath"]["fileNameTemplate"].format(
        transaction_id=transaction_id, entry_index=index, kind=kind
    )
    return (PurePosixPath(destination).parent / name).as_posix()


def _journal(contract: dict, destinations: list[str], transaction_id: str = "a" * 32) -> dict:
    return {
        "schema_version": contract["journal"]["schemaVersion"],
        "transaction_id": transaction_id,
        "state": "prepared",
        "entries": [
            {
                "destination": destination,
                "staging": _internal_path(contract, destination, transaction_id, index, "staging"),
                "rollback": None,
                "existed_before": False,
            }
            for index, destination in enumerate(destinations)
        ],
    }


def _accepts(payload: dict) -> bool:
    try:
        transaction._parse_journal_payload(payload)
    except ValueError:
        return False
    return True


def _check_rules(contract: dict, task_dir: Path) -> None:
    task_dir.mkdir(parents=True)
    manifest = contract["commitOrder"]["manifestDestination"]
    assert transaction._MANIFEST_DESTINATION == manifest
    destinations = [value for value in contract["allowedDestinations"] if value != manifest]
    pattern = contract["journal"]["transactionIdPattern"]
    assert transaction._TRANSACTION_ID_PATTERN.pattern == pattern
    for identifier in [
        "",
        "a" * 16,
        "a" * 31,
        "a" * 32,
        "a" * 33,
        "A" * 32,
        "g" * 32,
        "0" * 32,
        "0123456789abcdef" * 2,
        "a" * 31 + "\n",
        "é" * 16,
    ]:
        assert _accepts(_journal(contract, destinations[:1], identifier)) == bool(
            re.fullmatch(pattern, identifier)
        )

    minimum = contract["journal"]["minimumEntries"]
    maximum = contract["journal"]["maximumEntries"]
    for count in [minimum - 1, minimum, maximum, maximum + 1]:
        selected = destinations[:count]
        assert len(selected) == count
        expected = minimum <= count <= maximum
        assert _accepts(_journal(contract, selected)) == expected
        mutations = dict.fromkeys(selected, b"new content\n")
        if expected:
            assert len(transaction._validate_mutations(task_dir, mutations)) == count
        else:
            with pytest.raises(ValueError):
                transaction._validate_mutations(task_dir, mutations)

    for destination in contract["allowedDestinations"]:
        for index in [0, maximum - 1]:
            for kind in contract["internalPath"]["kinds"]:
                actual = transaction._internal_relative_path(destination, "a" * 32, index, kind)
                assert actual == _internal_path(contract, destination, "a" * 32, index, kind)
                assert (PurePosixPath(actual).parent == PurePosixPath(destination).parent) == (
                    contract["internalPath"]["sameDirectoryAsDestination"]
                )

    base = _journal(contract, destinations[:1])
    nullable = []
    for field in contract["entry"]["requiredFields"]:
        with_null = copy.deepcopy(base)
        with_null["entries"][0][field] = None
        if _accepts(with_null):
            nullable.append(field)
        missing = copy.deepcopy(base)
        del missing["entries"][0][field]
        assert not _accepts(missing)
    assert sorted(nullable) == sorted(contract["entry"]["nullableFields"])

    assert _accepts(_journal(contract, [manifest, destinations[0]])) == (
        not contract["commitOrder"]["manifestMustBeLast"]
    )
    assert _accepts(_journal(contract, [destinations[0], manifest]))
    ordered = transaction._validate_mutations(
        task_dir, {manifest: b"{}\n", destinations[0]: b"new content\n"}
    )
    assert (ordered[-1][0] == manifest) == contract["commitOrder"]["manifestMustBeLast"]

    for state in ["prepared", "committed"]:
        root = task_dir / state
        root.mkdir()
        payload = _journal(contract, destinations[:1])
        payload["state"] = state
        entry = payload["entries"][0]
        entry["existed_before"] = True
        entry["rollback"] = _internal_path(contract, entry["destination"], "a" * 32, 0, "rollback")
        for relative, content in [
            (entry["destination"], b"new content\n"),
            (entry["staging"], b"new content\n"),
            (entry["rollback"], b"old content\n"),
        ]:
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        (root / transaction.JOURNAL_FILE_NAME).write_text(json.dumps(payload), encoding="utf-8")
        transaction.recover_task_artifacts(root)
        assert ((root / entry["destination"]).read_bytes() == b"new content\n") == (
            state == "committed" and contract["commitOrder"]["journalCommittedStateIsCommitPoint"]
        )
        assert not (root / transaction.JOURNAL_FILE_NAME).exists()
        assert not (root / entry["staging"]).exists()
        assert not (root / entry["rollback"]).exists()


def test_declared_transaction_rules_match_python_behavior(tmp_path: Path) -> None:
    _check_rules(_load_contract(), tmp_path / "task")


@pytest.mark.parametrize(
    ("section", "field", "value"),
    [
        ("journal", "transactionIdPattern", "^[0-9a-f]{16}$"),
        ("journal", "minimumEntries", 2),
        ("journal", "maximumEntries", 7),
        ("internalPath", "fileNameTemplate", ".changed-{transaction_id}-{entry_index}.{kind}"),
        ("internalPath", "sameDirectoryAsDestination", False),
        ("entry", "nullableFields", ["staging"]),
        ("commitOrder", "manifestDestination", "ai/summary.md"),
        ("commitOrder", "manifestMustBeLast", False),
        ("commitOrder", "journalCommittedStateIsCommitPoint", False),
    ],
    ids=lambda value: value if isinstance(value, str) else None,
)
def test_each_declared_rule_change_is_detected(
    section: str, field: str, value: object, tmp_path: Path
) -> None:
    contract = _load_contract()
    contract[section][field] = value
    with pytest.raises(AssertionError):
        _check_rules(contract, tmp_path / "task")
