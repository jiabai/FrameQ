use serde::Deserialize;
use std::io::{BufRead, Read, Write};

pub const RECORD_LIMIT: usize = 40 * 1024 * 1024;
pub const SCRIPT_LIMIT: usize = 2 * 1024 * 1024;
pub type HostResult<T> = Result<T, &'static str>;

pub fn canonical_uuid(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok_and(|id| id.to_string() == value)
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
pub enum Input {
    #[serde(rename = "init")]
    Init {
        contract_version: u32,
        operation_id: String,
        session_id: String,
        url: String,
        extraction_script: String,
        platform: Platform,
        deadline_ms: u64,
    },
    #[serde(rename = "start")]
    Start { contract_version: u32, operation_id: String, session_id: String },
    #[serde(rename = "cancel")]
    Cancel { contract_version: u32, operation_id: String, session_id: String },
    #[serde(rename = "policy_decision")]
    PolicyDecision {
        contract_version: u32,
        operation_id: String,
        session_id: String,
        request_id: u64,
        navigation_generation: u64,
        allow: bool,
        #[serde(deserialize_with = "required_nullable")]
        error: Option<String>,
    },
}

fn required_nullable<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(deserializer)
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum Platform {
    #[serde(rename = "windows")]
    Windows { user_data_dir: String },
}

impl Input {
    pub fn identity(&self) -> (u32, &str, &str) {
        match self {
            Self::Init { contract_version, operation_id, session_id, .. }
            | Self::Start { contract_version, operation_id, session_id }
            | Self::Cancel { contract_version, operation_id, session_id }
            | Self::PolicyDecision { contract_version, operation_id, session_id, .. } =>
                (*contract_version, operation_id, session_id),
        }
    }
}

pub fn read_record<R: BufRead>(reader: &mut R) -> HostResult<Option<Input>> {
    let mut record = Vec::new();
    reader.take((RECORD_LIMIT + 1) as u64).read_until(b'\n', &mut record)
        .map_err(|_| "WEB_PROTOCOL_INVALID")?;
    if record.is_empty() { return Ok(None); }
    if record.len() > RECORD_LIMIT || record.last() != Some(&b'\n') {
        return Err("WEB_PROTOCOL_INVALID");
    }
    let input: Input = serde_json::from_slice(&record).map_err(|_| "WEB_PROTOCOL_INVALID")?;
    let (version, operation, session) = input.identity();
    if version != 1 || !canonical_uuid(operation) || !canonical_uuid(session) {
        return Err("WEB_PROTOCOL_INVALID");
    }
    if let Input::Init { extraction_script, .. } = &input {
        if extraction_script.is_empty() || extraction_script.len() > SCRIPT_LIMIT || extraction_script.contains('\0') {
            return Err("WEB_PROTOCOL_INVALID");
        }
    }
    Ok(Some(input))
}

#[derive(Clone)]
pub struct Identity { pub operation_id: String, pub session_id: String }

impl Identity {
    pub fn matches(&self, input: &Input) -> bool {
        let (version, operation, session) = input.identity();
        version == 1 && operation == self.operation_id && session == self.session_id
    }

    pub fn emit(&self, mut value: serde_json::Value) -> HostResult<()> {
        let object = value.as_object_mut().ok_or("WEB_PROTOCOL_INVALID")?;
        object.insert("contract_version".into(), 1.into());
        object.insert("operation_id".into(), self.operation_id.clone().into());
        object.insert("session_id".into(), self.session_id.clone().into());
        let bytes = serde_json::to_vec(&value).map_err(|_| "WEB_PROTOCOL_INVALID")?;
        if bytes.len() + 1 > RECORD_LIMIT { return Err("WEB_PROTOCOL_INVALID"); }
        let mut output = std::io::stdout().lock();
        output.write_all(&bytes).and_then(|_| output.write_all(b"\n"))
            .and_then(|_| output.flush()).map_err(|_| "WEB_HOST_FAILED")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_fields_are_rejected_before_native_startup() {
        let mut input = std::io::Cursor::new(br#"{"type":"cancel","contract_version":1,"operation_id":"bbd02c47-7155-47e9-b72b-be6583cbff09","session_id":"bbd02c47-7155-47e9-b72b-be6583cbff09","extra":true}
"#);
        assert_eq!(read_record(&mut input).unwrap_err(), "WEB_PROTOCOL_INVALID");
    }

    #[test]
    fn invalid_version_and_uuid_are_rejected() {
        for record in [
            r#"{"type":"cancel","contract_version":2,"operation_id":"bbd02c47-7155-47e9-b72b-be6583cbff09","session_id":"bbd02c47-7155-47e9-b72b-be6583cbff09"}"#,
            r#"{"type":"cancel","contract_version":1,"operation_id":"wrong","session_id":"wrong"}"#,
        ] {
            assert!(read_record(&mut std::io::Cursor::new(format!("{record}\n"))).is_err());
        }
    }

    #[test]
    fn json_messages_reject_noncanonical_operation_and_session_uuids() {
        let canonical = "bbd02c47-7155-47e9-b72b-be6583cbff09";
        for (operation, session) in [(canonical.to_uppercase(), canonical.to_owned()),
            (canonical.to_owned(), canonical.replace('-', ""))] {
            let value = serde_json::json!({"type":"cancel", "contract_version":1,
                "operation_id":operation, "session_id":session});
            let mut input = std::io::Cursor::new(format!("{value}\n"));
            assert!(read_record(&mut input).is_err());
        }
    }

    #[test]
    fn json_initialization_enforces_two_mebibyte_script_limit() {
        for (bytes, accepted) in [(2 * 1024 * 1024, true), (2 * 1024 * 1024 + 1, false)] {
            let value = serde_json::json!({"type":"init", "contract_version":1,
                "operation_id":"bbd02c47-7155-47e9-b72b-be6583cbff09", "session_id":"7213a9bd-a39b-4d3b-b33c-c35408a53135",
                "url":"https://example.com/", "extraction_script":"x".repeat(bytes),
                "platform":{"kind":"windows", "user_data_dir":"D:\\FrameQ\\profile"}, "deadline_ms":90000});
            let mut input = std::io::Cursor::new(format!("{value}\n"));
            assert_eq!(read_record(&mut input).is_ok(), accepted);
        }
    }

    #[test]
    fn records_require_newline_and_bound_the_encoded_size() {
        assert!(read_record(&mut std::io::Cursor::new(b"{}" )).is_err());
        assert!(read_record(&mut std::io::Cursor::new(vec![b' '; RECORD_LIMIT + 1])).is_err());
    }
}
