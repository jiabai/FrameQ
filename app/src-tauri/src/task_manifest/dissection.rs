use crate::worker_runtime::{validate_task_dissection, TaskDissection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const INVALID_DISSECTION_ARTIFACT: &str = "Task dissection artifact is invalid.";

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum DissectionSourceStatus {
    Current,
    Stale,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub(crate) struct DissectionView {
    pub(crate) report: TaskDissection,
    pub(crate) source_status: DissectionSourceStatus,
}

pub(super) fn verify_dissection_source(
    report: &TaskDissection,
    transcript: &[u8],
) -> Result<DissectionSourceStatus, String> {
    if !validate_task_dissection(report) {
        return Err(INVALID_DISSECTION_ARTIFACT.to_string());
    }
    if sha256_hex(transcript) != report.source_sha256() {
        return Ok(DissectionSourceStatus::Stale);
    }

    let mut expected_start = 0usize;
    for chunk in &report.source_chunks {
        let start = usize::try_from(chunk.start_byte)
            .map_err(|_| INVALID_DISSECTION_ARTIFACT.to_string())?;
        let end =
            usize::try_from(chunk.end_byte).map_err(|_| INVALID_DISSECTION_ARTIFACT.to_string())?;
        if start != expected_start
            || end > transcript.len()
            || std::str::from_utf8(&transcript[start..end]).is_err()
            || sha256_hex(&transcript[start..end]) != chunk.sha256
        {
            return Err(INVALID_DISSECTION_ARTIFACT.to_string());
        }
        expected_start = end;
    }
    if expected_start != transcript.len() {
        return Err(INVALID_DISSECTION_ARTIFACT.to_string());
    }
    Ok(DissectionSourceStatus::Current)
}

pub(super) fn build_dissection_view(
    report: TaskDissection,
    transcript: &[u8],
    kind: super::SourceTextKind,
) -> Result<DissectionView, String> {
    if report.is_article() != (kind == super::SourceTextKind::Article) {
        return Err(INVALID_DISSECTION_ARTIFACT.to_string());
    }
    let source_status = verify_dissection_source(&report, transcript)?;
    Ok(DissectionView {
        report,
        source_status,
    })
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::{build_dissection_view, verify_dissection_source, DissectionSourceStatus};
    use crate::worker_runtime::TaskDissection;

    fn report() -> TaskDissection {
        serde_json::from_value(serde_json::json!({
            "schemaVersion": 1,
            "sourceTranscriptSha256": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            "sourceLanguage": null,
            "sourceChunks": [{"id": 1, "startByte": 0, "endByte": 3,
                "sha256": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"}],
            "overallNarrative": {"openingHook": null, "structureType": "statement",
                "turningPoint": null, "closingType": null},
            "segments": [{"id": 1, "title": "Opening", "sourceChunkIds": [1],
                "coreClaim": "abc", "supportingPoints": [], "rhetoricalDevices": [],
                "rhythmNote": "Brief", "reusablePattern": "Direct", "riskFlags": []}],
            "highlights": ["abc"],
            "reusableTemplate": {"name": "Direct", "skeleton": ["A", "B", "C"]},
            "audienceFit": [], "strengths": ["Direct"], "weaknesses": ["Brief"]
        }))
        .expect("valid report")
    }

    #[test]
    fn source_verification_distinguishes_current_and_stale_bytes() {
        assert_eq!(
            verify_dissection_source(&report(), b"abc").expect("verify current"),
            DissectionSourceStatus::Current
        );
        assert_eq!(
            verify_dissection_source(&report(), b"abd").expect("verify stale"),
            DissectionSourceStatus::Stale
        );
    }

    #[test]
    fn source_verification_rejects_structurally_invalid_ranges() {
        let mut invalid = report();
        invalid.source_chunks[0].end_byte = 4;
        assert!(verify_dissection_source(&invalid, b"abc").is_err());
    }

    #[test]
    fn article_dissection_uses_version_two_and_its_exact_source_bytes() {
        let mut value = serde_json::to_value(report()).unwrap();
        let hash = value.as_object_mut().unwrap().remove("sourceTranscriptSha256").unwrap();
        value["schemaVersion"] = serde_json::json!(2);
        value["sourceKind"] = serde_json::json!("article");
        value["sourceTextSha256"] = hash;
        let article: TaskDissection = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(build_dissection_view(article.clone(), b"abc", crate::task_manifest::SourceTextKind::Article).unwrap().source_status, DissectionSourceStatus::Current);
        assert!(build_dissection_view(article, b"abc", crate::task_manifest::SourceTextKind::Transcript).is_err());
        value["sourceTranscriptSha256"] = serde_json::json!("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert!(!crate::worker_runtime::validate_task_dissection(&serde_json::from_value(value).unwrap()));
    }

    #[test]
    fn dissection_ranges_must_follow_utf8_character_boundaries() {
        let mut report = report();
        let bytes = "中".as_bytes();
        report.source_transcript_sha256 = Some(super::sha256_hex(bytes));
        report.source_chunks = vec![
            serde_json::from_value(serde_json::json!({"id":1,"startByte":0,"endByte":1,"sha256":super::sha256_hex(&bytes[..1])})).unwrap(),
            serde_json::from_value(serde_json::json!({"id":2,"startByte":1,"endByte":3,"sha256":super::sha256_hex(&bytes[1..])})).unwrap(),
        ];
        assert!(verify_dissection_source(&report, bytes).is_err());
    }
}
