use serde::Deserialize;
use std::io::{BufRead, Read};

pub(crate) const MESSAGE_LIMIT: usize = 40 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum HostStage { WebLoading, WebExtracting }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum PolicyKind { Resource, Navigation }

#[derive(Debug, Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
pub(crate) enum HostMessage {
    #[serde(rename = "ready")]
    Ready { contract_version: u32, operation_id: String, session_id: String, runtime_version: String,
        #[serde(deserialize_with = "required_nullable_pid")] browser_pid: Option<u32> },
    #[serde(rename = "stage")]
    Stage { contract_version: u32, operation_id: String, session_id: String, navigation_generation: u64, stage: HostStage },
    #[serde(rename = "policy_check")]
    PolicyCheck { contract_version: u32, operation_id: String, session_id: String, request_id: u64, navigation_generation: u64, url: String, kind: PolicyKind },
    #[serde(rename = "article")]
    Article { contract_version: u32, operation_id: String, session_id: String, navigation_generation: u64, final_url: String, title: String, text: String, markdown: String },
    #[serde(rename = "error")]
    Error { contract_version: u32, operation_id: String, session_id: String, code: String },
    #[serde(rename = "closed")]
    Closed { contract_version: u32, operation_id: String, session_id: String, clean: bool },
}

fn required_nullable_pid<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<u32>, D::Error> { Option::<u32>::deserialize(deserializer) }

impl HostMessage {
    pub(crate) fn matches(&self, operation: &str, session: &str) -> bool {
        let (version, op, sid) = match self {
            Self::Ready { contract_version, operation_id, session_id, .. }
            | Self::Stage { contract_version, operation_id, session_id, .. }
            | Self::PolicyCheck { contract_version, operation_id, session_id, .. }
            | Self::Article { contract_version, operation_id, session_id, .. }
            | Self::Error { contract_version, operation_id, session_id, .. }
            | Self::Closed { contract_version, operation_id, session_id, .. } => (*contract_version, operation_id, session_id),
        };
        version == 1 && op == operation && sid == session
    }
}

pub(crate) fn read_message(reader: &mut impl BufRead) -> Result<Option<(HostMessage, usize)>, String> {
    let mut bytes = Vec::new();
    reader.take((MESSAGE_LIMIT + 1) as u64).read_until(b'\n', &mut bytes).map_err(|_| "WEB_PROTOCOL_INVALID")?;
    if bytes.is_empty() { return Ok(None); }
    if bytes.len() > MESSAGE_LIMIT || bytes.last() != Some(&b'\n') { return Err("WEB_PROTOCOL_INVALID".into()); }
    let message = serde_json::from_slice(&bytes).map_err(|_| "WEB_PROTOCOL_INVALID")?;
    Ok(Some((message, bytes.len())))
}

#[derive(Debug)]
pub(crate) struct HostArticle {
    pub(crate) navigation_generation: u64,
    pub(crate) final_url: String,
    pub(crate) title: String,
    pub(crate) text: String,
    pub(crate) markdown: String,
}

impl HostArticle {
    pub(crate) fn validate(&self) -> Result<(), String> {
        if self.navigation_generation == 0 || self.title.trim().is_empty() || self.title.chars().count() > 512
            || self.title.chars().any(char::is_control) || self.text.len() > 2 * 1024 * 1024
            || self.text.chars().filter(|ch| !ch.is_whitespace()).count() < 50
            || self.markdown.trim().is_empty() || self.markdown.len() > 4 * 1024 * 1024 {
            return Err("WEB_EXTRACTION_FAILED".into());
        }
        crate::task_manifest::validate_web_request_url(&self.final_url).map_err(|_| "WEB_URL_BLOCKED".to_owned())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn closed_host_messages_reject_unknown_fields_and_missing_nullable_pid() {
        for value in [
            r#"{"type":"closed","contract_version":1,"operation_id":"operation","session_id":"session","clean":true,"extra":true}"#,
            r#"{"type":"ready","contract_version":1,"operation_id":"operation","session_id":"session","runtime_version":"156"}"#,
        ] {
            assert!(read_message(&mut std::io::Cursor::new(format!("{value}\n"))).is_err());
        }
    }
    #[test]
    fn host_messages_are_bound_to_the_expected_operation_and_session() {
        let mut input = std::io::Cursor::new(b"{\"type\":\"closed\",\"contract_version\":1,\"operation_id\":\"operation\",\"session_id\":\"session\",\"clean\":true}\n");
        let (message, _) = read_message(&mut input).unwrap().unwrap();
        assert!(message.matches("operation", "session"));
        assert!(!message.matches("operation", "other"));
    }
}
