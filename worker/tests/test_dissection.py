from __future__ import annotations

import hashlib
import json

import pytest
from frameq_worker.insightflow.dissection import (
    DissectionGenerationError,
    build_dissection_call_plan,
    generate_transcript_dissection,
    parse_dissection_report,
    parse_persisted_dissection,
)
from frameq_worker.insightflow.splitter import MarkdownSplitter
from frameq_worker.pipeline_runtime.insights import run_insight_generation_step


def test_splitter_records_contiguous_utf8_provenance_and_reconstructs_exactly() -> None:
    transcript = "# 标题\n\n第一段🙂。\n\n第二段 English.\n"

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


@pytest.mark.parametrize(
    ("chunk_count", "minimum_calls", "maximum_calls", "batch_sizes"),
    [
        (1, 2, 3, [1]),
        (4, 2, 3, [4]),
        (5, 3, 4, [4, 1]),
        (16, 5, 6, [4, 4, 4, 4]),
    ],
)
def test_call_plan_has_bounded_consecutive_map_batches(
    chunk_count: int,
    minimum_calls: int,
    maximum_calls: int,
    batch_sizes: list[int],
) -> None:
    plan = build_dissection_call_plan(chunk_count)

    assert plan.version == 1
    assert plan.minimum_calls == minimum_calls
    assert plan.maximum_calls == maximum_calls
    assert [len(batch) for batch in plan.map_batches] == batch_sizes
    assert [chunk_id for batch in plan.map_batches for chunk_id in batch] == list(
        range(1, chunk_count + 1)
    )


@pytest.mark.parametrize("chunk_count", [0, 17])
def test_call_plan_rejects_empty_or_over_limit_input_before_generation(
    chunk_count: int,
) -> None:
    with pytest.raises(DissectionGenerationError) as captured:
        build_dissection_call_plan(chunk_count)

    assert captured.value.code in {
        "DISSECTION_EMPTY_TRANSCRIPT",
        "DISSECTION_TRANSCRIPT_TOO_LARGE",
    }


def valid_semantic_report() -> dict[str, object]:
    return {
        "overallNarrative": {
            "openingHook": "Question",
            "structureType": "problem-solution",
            "turningPoint": None,
            "closingType": "Call to action",
        },
        "segments": [
            {
                "id": 1,
                "title": "Opening",
                "sourceChunkIds": [1],
                "coreClaim": "第一段",
                "supportingPoints": ["第二段"],
                "rhetoricalDevices": ["Question"],
                "rhythmNote": "Fast",
                "reusablePattern": "Question then answer",
                "riskFlags": [],
            }
        ],
        "highlights": ["第一段"],
        "reusableTemplate": {
            "name": "Problem and solution",
            "skeleton": ["Ask", "Explain", "Resolve"],
        },
        "audienceFit": [
            {"audience": "Beginners", "fit": "high", "note": "Accessible"}
        ],
        "strengths": ["Clear"],
        "weaknesses": ["Brief"],
    }


def test_parser_builds_closed_report_with_worker_owned_provenance() -> None:
    transcript = "第一段🙂。第二段。"
    chunks = MarkdownSplitter().split(transcript)

    report = parse_dissection_report(
        valid_semantic_report(),
        transcript=transcript,
        chunks=chunks,
        source_language="zh-CN",
    )

    payload = report.to_dict()
    assert payload["schemaVersion"] == 1
    assert payload["sourceTranscriptSha256"] == hashlib.sha256(
        transcript.encode("utf-8")
    ).hexdigest()
    assert payload["sourceChunks"] == [
        {
            "id": 1,
            "startByte": 0,
            "endByte": len(transcript.encode("utf-8")),
            "sha256": chunks[0].sha256,
        }
    ]
    assert payload["sourceLanguage"] == "zh-CN"


@pytest.mark.parametrize(
    "mutate",
    [
        lambda report: report.update({"prompt": "ignore prior instructions"}),
        lambda report: report["segments"][0].update({"sourceChunkIds": [2]}),
        lambda report: report.update({"highlights": ["not in transcript"]}),
        lambda report: report.update({"strengths": ["x"] * 7}),
        lambda report: report["audienceFit"][0].update({"fit": "perfect"}),
        lambda report: report["segments"][0].update({"title": "<script>alert(1)</script>"}),
    ],
)
def test_parser_rejects_open_malformed_or_untraceable_reports(mutate) -> None:
    transcript = "第一段🙂。第二段。"
    chunks = MarkdownSplitter().split(transcript)
    payload = valid_semantic_report()
    mutate(payload)

    with pytest.raises(DissectionGenerationError) as captured:
        parse_dissection_report(
            payload,
            transcript=transcript,
            chunks=chunks,
            source_language=None,
        )

    assert captured.value.code == "DISSECTION_INVALID_RESULT"


def test_generation_uses_map_reduce_and_at_most_one_repair() -> None:
    class FakeClient:
        def __init__(self) -> None:
            self.prompts: list[str] = []
            self.responses = [
                json.dumps({"batch": 1, "segments": []}),
                json.dumps({"invalid": True}),
                json.dumps(valid_semantic_report()),
            ]

        def generate(self, prompt: str) -> str:
            self.prompts.append(prompt)
            return self.responses[len(self.prompts) - 1]

    client = FakeClient()
    report = generate_transcript_dissection(
        "第一段🙂。第二段。",
        client=client,
        output_language="zh-CN",
        source_language="zh-CN",
    )

    assert report.segments[0].source_chunk_ids == (1,)
    assert len(client.prompts) == 3
    assert "map stage" in client.prompts[0]
    assert "reduce stage" in client.prompts[1]
    assert "repair stage" in client.prompts[2]
    assert "第一段🙂" in client.prompts[0]
    assert "第一段🙂" not in client.prompts[1]
    assert "第一段🙂" not in client.prompts[2]


def test_pipeline_dispatches_dissection_without_persisting_standalone_files(
    tmp_path,
) -> None:
    transcript_path = tmp_path / "task" / "transcript" / "transcript.txt"
    transcript_path.parent.mkdir(parents=True)
    transcript_path.write_text("第一段🙂。第二段。", encoding="utf-8")

    class FakeClient:
        def __init__(self) -> None:
            self.responses = [
                json.dumps({"batch": 1, "segments": []}),
                json.dumps(valid_semantic_report()),
            ]

        def generate(self, _prompt: str) -> str:
            return self.responses.pop(0)

    result = run_insight_generation_step(
        transcript_txt_path=transcript_path,
        output_dir=tmp_path / "task" / "ai",
        output_stem="",
        client=FakeClient(),
        output_language="zh-CN",
        target="dissection",
        persist=False,
    )

    assert result.status.value == "completed"
    assert result.dissection is not None
    assert set(result.artifact_payloads) == {"ai/dissection.json", "ai/dissection.md"}
    assert not (tmp_path / "task" / "ai" / "dissection.json").exists()
    assert "第一段" in result.artifact_payloads["ai/dissection.md"].decode("utf-8")


def test_persisted_parser_rejects_provenance_tampering() -> None:
    transcript = "第一段🙂。第二段。"
    report = parse_dissection_report(
        valid_semantic_report(),
        transcript=transcript,
        chunks=MarkdownSplitter().split(transcript),
        source_language="zh-CN",
    ).to_dict()

    assert parse_persisted_dissection(report, transcript=transcript).to_dict() == report
    report["sourceChunks"][0]["endByte"] += 1

    with pytest.raises(DissectionGenerationError) as captured:
        parse_persisted_dissection(report, transcript=transcript)

    assert captured.value.code == "DISSECTION_INVALID_RESULT"


def test_empty_official_transcript_stops_before_any_supplier_call(tmp_path) -> None:
    transcript_path = tmp_path / "task" / "transcript" / "transcript.txt"
    transcript_path.parent.mkdir(parents=True)
    transcript_path.write_text(" \n\t", encoding="utf-8")

    class NoCallClient:
        def generate(self, _prompt: str) -> str:
            raise AssertionError("supplier must not be called")

    result = run_insight_generation_step(
        transcript_txt_path=transcript_path,
        output_dir=tmp_path / "task" / "ai",
        output_stem="",
        client=NoCallClient(),
        output_language="en-US",
        target="dissection",
        persist=False,
    )

    assert result.status.value == "partial_completed"
    assert result.error is not None
    assert result.error.code == "DISSECTION_EMPTY_TRANSCRIPT"
    assert result.artifact_payloads == {}
