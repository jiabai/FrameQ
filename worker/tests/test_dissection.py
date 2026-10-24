from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
from frameq_worker.ai_prompts import build_dissection_agent_prompt
from frameq_worker.dissection_report import (
    DissectionGenerationError,
    build_dissection_artifacts,
    format_dissection_markdown,
    parse_dissection_report,
    parse_persisted_dissection,
)
from frameq_worker.transcript_chunks import MarkdownSplitter


def valid_semantic_report() -> dict[str, object]:
    return {
        "overallNarrative": {
            "openingHook": "Question",
            "structureType": "Problem and solution",
            "turningPoint": "The proposed solution",
            "closingType": "Call to action",
        },
        "segments": [{
            "id": 1,
            "title": "Opening",
            "sourceChunkIds": [1],
            "coreClaim": "第一段",
            "supportingPoints": ["第二段"],
            "rhetoricalDevices": ["Question"],
            "rhythmNote": "Fast",
            "reusablePattern": "Introduce [problem], then explain [solution]",
            "riskFlags": ["The claim needs verification"],
        }],
        "highlights": ["第一段"],
        "reusableTemplate": {
            "name": "Problem and solution",
            "skeleton": ["Introduce [problem]", "Explain [evidence]", "Offer [action]"],
        },
        "audienceFit": [
            {"audience": "Beginners", "fit": "high", "note": "Accessible"},
            {"audience": "Practitioners", "fit": "medium", "note": "Concise"},
            {"audience": "Experts", "fit": "low", "note": "Limited depth"},
        ],
        "strengths": ["Clear"],
        "weaknesses": ["Brief"],
    }


def test_splitter_records_contiguous_utf8_provenance_and_reconstructs_exactly() -> None:
    transcript = "# 标题\r\n\r\n第一段🙂。\r\n\r\n第二段 English.\r\n"
    chunks = MarkdownSplitter(max_length=10).split(transcript)

    assert [chunk.id for chunk in chunks] == list(range(1, len(chunks) + 1))
    assert all(0 < len(chunk.content) <= 10 for chunk in chunks)
    assert "".join(chunk.content for chunk in chunks) == transcript
    assert chunks[0].start_byte == 0
    assert chunks[-1].end_byte == len(transcript.encode("utf-8"))
    assert all(
        current.end_byte == following.start_byte
        for current, following in zip(chunks, chunks[1:], strict=False)
    )
    transcript_bytes = transcript.encode("utf-8")
    for chunk in chunks:
        source_slice = transcript_bytes[chunk.start_byte : chunk.end_byte]
        assert source_slice.decode("utf-8") == chunk.content
        assert chunk.sha256 == hashlib.sha256(source_slice).hexdigest()


def test_prompt_declares_tool_delivery_complete_schema_and_source_limits() -> None:
    chunks = MarkdownSplitter(max_length=8).split("开头钩子。中段论证。结尾行动。")
    prompt = build_dissection_agent_prompt(chunks, "en-US")

    for key in valid_semantic_report():
        assert f'"{key}"' in prompt
    assert "submit_dissection" in prompt
    assert f"Legal sourceChunkIds: {[chunk.id for chunk in chunks]}" in prompt
    assert "character-for-character" in prompt
    assert "never paraphrase, summarize, translate, or normalize" in prompt
    assert "3 through 7" in prompt
    assert "at most 8" in prompt
    assert "at most 6" in prompt
    assert '"high" | "medium" | "low"' in prompt
    assert "replaceable bracketed slots" in prompt
    assert "optional or removable nodes" in prompt
    assert "applicable content types" in prompt
    assert "global inapplicability" in prompt
    assert "store global transfer limits in `weaknesses`" in prompt
    assert "Do not invent a product, audience, performance outcome, or use case" in prompt
    assert "Do not infer visual, audio, speaking-rate, editing, or conversion" in prompt
    for chunk in chunks:
        assert chunk.content in prompt


def test_parser_builds_closed_report_with_worker_owned_provenance() -> None:
    transcript = "第一段🙂。\r\n第二段。\r\n"
    chunks = MarkdownSplitter().split(transcript)
    report = parse_dissection_report(
        valid_semantic_report(), transcript=transcript, chunks=chunks, source_language="zh-CN",
    )
    payload = report.to_dict()

    assert payload["schemaVersion"] == 1
    assert payload["sourceTranscriptSha256"] == hashlib.sha256(transcript.encode()).hexdigest()
    assert payload["sourceChunks"] == [{
        "id": 1, "startByte": 0, "endByte": len(transcript.encode()), "sha256": chunks[0].sha256,
    }]
    assert payload["sourceLanguage"] == "zh-CN"
    assert set(payload) == {
        "schemaVersion", "sourceTranscriptSha256", "sourceLanguage", "sourceChunks",
        *valid_semantic_report(),
    }


@pytest.mark.parametrize(
    ("language", "labels"),
    [
        ("zh-CN", [
            "文字稿解剖", "整体叙事", "核心论点", "可复用骨架",
            "适配度：高", "适配度：中", "适配度：低",
        ]),
        ("zh-TW", [
            "逐字稿解剖", "整體敘事", "核心論點", "可重用骨架",
            "適配度：高", "適配度：中", "適配度：低",
        ]),
        ("en-US", [
            "Transcript Dissection", "Overall Narrative", "Core claim", "Reusable template",
            "Fit: High", "Fit: Medium", "Fit: Low",
        ]),
    ],
)
def test_markdown_exports_report_fields_in_each_language(language, labels: list[str]) -> None:
    transcript = "第一段。第二段。PRIVATE_UNUSED_SOURCE"
    report = parse_dissection_report(
        valid_semantic_report(), transcript=transcript,
        chunks=MarkdownSplitter().split(transcript), source_language="zh-CN",
    )
    markdown = format_dissection_markdown(report, language)

    for label in labels:
        assert label in markdown
    for field in (
        "Question", "Problem and solution", "The proposed solution", "Call to action",
        "Opening", "第一段", "第二段", "Fast", "Introduce [problem], then explain [solution]",
        "The claim needs verification", "Introduce [problem]", "Explain [evidence]",
        "Offer [action]",
        "Beginners", "Accessible", "Practitioners", "Concise", "Experts", "Limited depth",
        "Clear", "Brief",
    ):
        assert field in markdown
    for internal in (
        "schemaVersion", "sourceTranscriptSha256", "startByte", "endByte", "PRIVATE_UNUSED_SOURCE",
    ):
        assert internal not in markdown
    assert report.source_transcript_sha256 not in markdown


def test_markdown_omits_absent_optional_and_empty_sections() -> None:
    transcript = "第一段。"
    payload = valid_semantic_report()
    payload["overallNarrative"] = {
        "openingHook": None, "structureType": "Structure only",
        "turningPoint": None, "closingType": None,
    }
    for name in ("supportingPoints", "rhetoricalDevices", "riskFlags"):
        payload["segments"][0][name] = []
    for name in ("highlights", "audienceFit", "strengths", "weaknesses"):
        payload[name] = []
    report = parse_dissection_report(
        payload, transcript=transcript,
        chunks=MarkdownSplitter().split(transcript), source_language=None,
    )
    markdown = format_dissection_markdown(report, "en-US")

    assert "Structure only" in markdown
    for heading in (
        "Opening hook", "Turning point", "Closing", "Supporting points", "Rhetorical devices",
        "Risk flags", "Highlights", "Audience fit", "Strengths", "Weaknesses",
    ):
        assert heading not in markdown


@pytest.mark.parametrize(
    "mutate",
    [
        lambda report: report.update({"prompt": "Unexpected field"}),
        lambda report: report["segments"][0].update({"sourceChunkIds": [2]}),
        lambda report: report["segments"][0].update({"sourceChunkIds": [1, 1]}),
        lambda report: report["segments"][0].update({"sourceChunkIds": [True]}),
        lambda report: report["segments"][0].update({"id": 2}),
        lambda report: report.update({"highlights": ["Absent quotation"]}),
        lambda report: report.update({"highlights": ["第一段"] * 9}),
        lambda report: report.update({"strengths": ["Point"] * 7}),
        lambda report: report.update({"weaknesses": ["Point"] * 7}),
        lambda report: report["audienceFit"][0].update({"fit": "perfect"}),
        lambda report: report["segments"][0].update({"title": "<script>alert(1)</script>"}),
        lambda report: report["segments"][0].update({"title": "javascript:alert(1)"}),
        lambda report: report["reusableTemplate"].update({"skeleton": ["Too short"]}),
    ],
)
def test_parser_rejects_open_malformed_or_untraceable_reports(mutate) -> None:
    transcript = "第一段🙂。第二段。"
    payload = valid_semantic_report()
    mutate(payload)

    with pytest.raises(DissectionGenerationError) as captured:
        parse_dissection_report(
            payload, transcript=transcript,
            chunks=MarkdownSplitter().split(transcript), source_language=None,
        )

    assert captured.value.code == "DISSECTION_INVALID_RESULT"


def test_persisted_report_rejects_provenance_tampering() -> None:
    transcript = "第一段🙂。第二段。"
    payload = parse_dissection_report(
        valid_semantic_report(), transcript=transcript,
        chunks=MarkdownSplitter().split(transcript), source_language="zh-CN",
    ).to_dict()

    assert parse_persisted_dissection(payload, transcript=transcript).to_dict() == payload
    payload["sourceChunks"][0]["endByte"] += 1
    with pytest.raises(DissectionGenerationError):
        parse_persisted_dissection(payload, transcript=transcript)


def test_artifact_builder_produces_fixed_paths_and_matching_json_without_writing(
    tmp_path: Path,
) -> None:
    transcript = "第一段。第二段。"
    report = parse_dissection_report(
        valid_semantic_report(), transcript=transcript,
        chunks=MarkdownSplitter().split(transcript), source_language=None,
    )

    artifacts = build_dissection_artifacts(report, output_dir=tmp_path, output_language="en-US")

    assert artifacts.json_path == tmp_path / "dissection.json"
    assert artifacts.markdown_path == tmp_path / "dissection.md"
    assert json.loads(artifacts.json_bytes) == report.to_dict()
    assert "# Transcript Dissection" in artifacts.markdown_bytes.decode()
    assert not artifacts.json_path.exists()
    assert not artifacts.markdown_path.exists()
