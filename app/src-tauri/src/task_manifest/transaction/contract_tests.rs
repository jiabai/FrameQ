use super::{
    internal_relative_path, recover_task_artifacts, valid_transaction_id,
    validate_journal_value_for_test, validate_mutations, TaskArtifactMutation, JOURNAL_FILE_NAME,
    MANIFEST_DESTINATION,
};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

fn contract() -> Value {
    serde_json::from_str(include_str!(
        "../../../../../contracts/task-artifact-transaction-v1.json"
    ))
    .expect("parse transaction contract")
}

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .expect("string array")
        .iter()
        .map(|value| value.as_str().expect("string item").to_string())
        .collect()
}

fn root() -> PathBuf {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../build")
        .join(format!(
            "side-transaction-contract-{}",
            uuid::Uuid::new_v4()
        ));
    fs::create_dir_all(&path).expect("create test directory");
    path
}

fn contract_path(
    contract: &Value,
    destination: &str,
    id: &str,
    index: usize,
    kind: &str,
) -> String {
    let name = contract["internalPath"]["fileNameTemplate"]
        .as_str()
        .expect("file name template")
        .replace("{transaction_id}", id)
        .replace("{entry_index}", &index.to_string())
        .replace("{kind}", kind);
    destination
        .rsplit_once('/')
        .map(|(parent, _)| format!("{parent}/{name}"))
        .unwrap_or(name)
}

fn journal(contract: &Value, destinations: &[String], id: &str) -> Value {
    let entries: Vec<Value> = destinations
        .iter()
        .enumerate()
        .map(|(index, destination)| {
            json!({
                "destination": destination,
                "staging": contract_path(contract, destination, id, index, "staging"),
                "rollback": null,
                "existed_before": false
            })
        })
        .collect();
    json!({
        "schema_version": contract["journal"]["schemaVersion"],
        "transaction_id": id,
        "state": "prepared",
        "entries": entries
    })
}

fn accepts(value: Value) -> bool {
    validate_journal_value_for_test(value).is_ok()
}

fn check_rules(contract: &Value, task_dir: &Path) {
    fs::create_dir_all(task_dir).expect("create task directory");
    let manifest = contract["commitOrder"]["manifestDestination"]
        .as_str()
        .expect("manifest destination");
    assert_eq!(manifest, MANIFEST_DESTINATION);
    let destinations: Vec<String> = strings(&contract["allowedDestinations"])
        .into_iter()
        .filter(|value| value != manifest)
        .collect();
    assert_eq!(
        contract["journal"]["transactionIdPattern"],
        "^[0-9a-f]{32}$"
    );
    for (id, expected) in [
        (String::new(), false),
        ("a".repeat(16), false),
        ("a".repeat(31), false),
        ("a".repeat(32), true),
        ("a".repeat(33), false),
        ("A".repeat(32), false),
        ("g".repeat(32), false),
        ("0".repeat(32), true),
        ("0123456789abcdef".repeat(2), true),
        (format!("{}\n", "a".repeat(31)), false),
        ("é".repeat(16), false),
    ] {
        assert_eq!(valid_transaction_id(&id), expected);
        assert_eq!(
            accepts(journal(contract, &destinations[..1], &id)),
            expected
        );
    }
    let minimum = contract["journal"]["minimumEntries"].as_u64().unwrap() as usize;
    let maximum = contract["journal"]["maximumEntries"].as_u64().unwrap() as usize;
    let id = "a".repeat(32);
    for count in [minimum - 1, minimum, maximum, maximum + 1] {
        let selected = &destinations[..count];
        let expected = (minimum..=maximum).contains(&count);
        assert_eq!(accepts(journal(contract, selected, &id)), expected);
        let mutations = selected
            .iter()
            .map(|destination| {
                TaskArtifactMutation::replace(destination, b"new content\n".to_vec())
            })
            .collect();
        assert_eq!(validate_mutations(task_dir, mutations).is_ok(), expected);
    }
    for destination in strings(&contract["allowedDestinations"]) {
        for index in [0, maximum - 1] {
            for kind in strings(&contract["internalPath"]["kinds"]) {
                let actual = internal_relative_path(&destination, &id, index, &kind);
                assert_eq!(
                    actual,
                    contract_path(contract, &destination, &id, index, &kind)
                );
                assert_eq!(
                    Path::new(&actual).parent() == Path::new(&destination).parent(),
                    contract["internalPath"]["sameDirectoryAsDestination"]
                        .as_bool()
                        .unwrap()
                );
            }
        }
    }
    let base = journal(contract, &destinations[..1], &id);
    let mut nullable = Vec::new();
    for field in strings(&contract["entry"]["requiredFields"]) {
        let mut with_null = base.clone();
        with_null["entries"][0][&field] = Value::Null;
        if accepts(with_null) {
            nullable.push(field.clone());
        }
        let mut missing = base.clone();
        missing["entries"][0]
            .as_object_mut()
            .unwrap()
            .remove(&field);
        assert!(!accepts(missing));
    }
    nullable.sort();
    let mut expected_nullable = strings(&contract["entry"]["nullableFields"]);
    expected_nullable.sort();
    assert_eq!(nullable, expected_nullable);
    let must_be_last = contract["commitOrder"]["manifestMustBeLast"]
        .as_bool()
        .unwrap();
    assert_eq!(
        accepts(journal(
            contract,
            &[manifest.to_string(), destinations[0].clone()],
            &id
        )),
        !must_be_last
    );
    assert!(accepts(journal(
        contract,
        &[destinations[0].clone(), manifest.to_string()],
        &id
    )));
    let ordered = validate_mutations(
        task_dir,
        vec![
            TaskArtifactMutation::manifest(b"{}\n".to_vec()),
            TaskArtifactMutation::replace(&destinations[0], b"new content\n".to_vec()),
        ],
    )
    .expect("order mutations");
    assert_eq!(
        ordered.last().unwrap().destination == manifest,
        must_be_last
    );
    for state in ["prepared", "committed"] {
        let root = task_dir.join(state);
        fs::create_dir_all(&root).expect("create recovery directory");
        let mut payload = journal(contract, &destinations[..1], &id);
        payload["state"] = json!(state);
        payload["entries"][0]["existed_before"] = json!(true);
        payload["entries"][0]["rollback"] = json!(contract_path(
            contract,
            &destinations[0],
            &id,
            0,
            "rollback"
        ));
        let entry = &payload["entries"][0];
        for (field, content) in [
            ("destination", b"new content\n"),
            ("staging", b"new content\n"),
            ("rollback", b"old content\n"),
        ] {
            let path = root.join(entry[field].as_str().unwrap());
            fs::create_dir_all(path.parent().unwrap()).expect("create material parent");
            fs::write(path, content).expect("write recovery material");
        }
        fs::write(
            root.join(JOURNAL_FILE_NAME),
            serde_json::to_vec(&payload).unwrap(),
        )
        .expect("write journal");
        recover_task_artifacts(&root).expect("recover task");
        assert_eq!(
            fs::read(root.join(&destinations[0])).unwrap() == b"new content\n",
            state == "committed"
                && contract["commitOrder"]["journalCommittedStateIsCommitPoint"]
                    .as_bool()
                    .unwrap()
        );
        assert!(!root.join(JOURNAL_FILE_NAME).exists());
        for field in ["staging", "rollback"] {
            assert!(!root.join(entry[field].as_str().unwrap()).exists());
        }
    }
}

#[test]
fn declared_transaction_rules_match_rust_behavior() {
    check_rules(&contract(), &root());
}

#[test]
fn each_declared_rule_change_is_detected() {
    for (section, field, value) in [
        ("journal", "transactionIdPattern", json!("^[0-9a-f]{16}$")),
        ("journal", "minimumEntries", json!(2)),
        ("journal", "maximumEntries", json!(7)),
        (
            "internalPath",
            "fileNameTemplate",
            json!(".changed-{transaction_id}-{entry_index}.{kind}"),
        ),
        ("internalPath", "sameDirectoryAsDestination", json!(false)),
        ("entry", "nullableFields", json!(["staging"])),
        ("commitOrder", "manifestDestination", json!("ai/summary.md")),
        ("commitOrder", "manifestMustBeLast", json!(false)),
        (
            "commitOrder",
            "journalCommittedStateIsCommitPoint",
            json!(false),
        ),
    ] {
        let mut changed = contract();
        changed[section][field] = value;
        let task_dir = root();
        assert!(
            std::panic::catch_unwind(|| check_rules(&changed, &task_dir)).is_err(),
            "{section}.{field} drift was not detected"
        );
    }
}
