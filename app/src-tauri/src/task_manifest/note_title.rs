use serde::{Deserialize, Deserializer, Serialize};
use unicode_general_category::{get_general_category, GeneralCategory};

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum NoteTitleStatus {
    Generating,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub(crate) struct NoteTitle {
    pub(crate) text: Option<String>,
    pub(crate) status: NoteTitleStatus,
    pub(crate) output_language: String,
    pub(crate) error_code: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NoteTitleWire {
    #[serde(deserialize_with = "required_nullable")]
    text: Option<String>,
    status: NoteTitleStatus,
    output_language: String,
    #[serde(deserialize_with = "required_nullable")]
    error_code: Option<String>,
}

fn required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

impl<'de> Deserialize<'de> for NoteTitle {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = NoteTitleWire::deserialize(deserializer)?;
        let title = Self {
            text: value.text,
            status: value.status,
            output_language: value.output_language,
            error_code: value.error_code,
        };
        if !title.is_valid() {
            return Err(serde::de::Error::custom("Invalid note title metadata."));
        }
        Ok(title)
    }
}

impl NoteTitle {
    pub(crate) fn is_valid(&self) -> bool {
        if !["zh-CN", "zh-TW", "en-US"].contains(&self.output_language.as_str())
            || self.text.as_ref().is_some_and(|text| !is_valid_title(text))
        {
            return false;
        }
        match self.status {
            NoteTitleStatus::Completed => self.text.is_some() && self.error_code.is_none(),
            NoteTitleStatus::Generating => self.error_code.is_none(),
            NoteTitleStatus::Failed | NoteTitleStatus::Cancelled => {
                self.error_code.as_ref().is_some_and(|code| {
                    !code.is_empty()
                        && code.len() <= 64
                        && code.bytes().enumerate().all(|(index, byte)| {
                            byte.is_ascii_uppercase()
                                || (index > 0 && (byte.is_ascii_digit() || byte == b'_'))
                        })
                })
            }
        }
    }
}

fn is_valid_title(text: &str) -> bool {
    !text.is_empty()
        && text.trim() == text
        && text.chars().count() <= 60
        && !text.chars().any(|ch| {
            matches!(
                get_general_category(ch),
                GeneralCategory::Control
                    | GeneralCategory::Format
                    | GeneralCategory::LineSeparator
                    | GeneralCategory::ParagraphSeparator
            )
        })
}

#[cfg(test)]
mod tests {
    use super::NoteTitle;
    use serde_json::json;

    #[test]
    fn title_metadata_validates_unicode_closed_shape_and_state() {
        let valid = json!({"text":"电影创作的新方向","status":"completed","output_language":"zh-CN","error_code":null});
        serde_json::from_value::<NoteTitle>(valid.clone()).expect("valid title");
        let mut astral = valid.clone();
        astral["text"] = json!("🎬".repeat(60));
        serde_json::from_value::<NoteTitle>(astral).expect("count Unicode characters");
        for text in ["".to_string(), " leading".to_string(), "two\nlines".to_string(), "format\u{200b}character".to_string(), "paragraph\u{2029}separator".to_string(), "🎬".repeat(61)] {
            let mut invalid = valid.clone();
            invalid["text"] = json!(text);
            assert!(serde_json::from_value::<NoteTitle>(invalid).is_err());
        }
        for (field, value) in [("text", serde_json::Value::Null), ("error_code", json!("TITLE_FAILED")), ("output_language", json!("fr-FR")), ("extra", json!(true))] {
            let mut invalid = valid.clone();
            invalid[field] = value;
            assert!(serde_json::from_value::<NoteTitle>(invalid).is_err());
        }
        for field in ["text", "error_code"] {
            let mut invalid = valid.clone();
            invalid.as_object_mut().unwrap().remove(field);
            assert!(serde_json::from_value::<NoteTitle>(invalid).is_err());
        }
    }
}
