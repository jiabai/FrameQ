from __future__ import annotations

from frameq_worker.insightflow.utils import extract_json_from_llm_output


def test_extract_accepts_bare_json() -> None:
    output = '{"segments": [], "highlights": ["原文"], "strengths": [], "weaknesses": []}'
    parsed = extract_json_from_llm_output(output)
    assert parsed == {
        "segments": [],
        "highlights": ["原文"],
        "strengths": [],
        "weaknesses": [],
    }


def test_extract_accepts_fenced_json() -> None:
    output = '```json\n{"a": 1}\n```'
    assert extract_json_from_llm_output(output) == {"a": 1}


def test_extract_accepts_plain_fence_without_json_marker() -> None:
    output = "```\n{\"a\": 1}\n```"
    assert extract_json_from_llm_output(output) == {"a": 1}


def test_extract_tolerates_curly_quote_used_as_string_delimiter() -> None:
    # DeepSeek-V3.2 long outputs occasionally replace a structural double quote
    # with a Chinese curly quote (U+201C/U+201D), which makes json.loads fail.
    output = (
        '{"highlights": ["基于国内网络环境的判断，海外用户情况可能不同。", '
        '"只要有数据，它就能变成视频"]}'
    ).replace('"基于', "\u201c基于", 1)
    parsed = extract_json_from_llm_output(output)
    assert parsed is not None
    assert parsed["highlights"][0] == "基于国内网络环境的判断，海外用户情况可能不同。"
    assert parsed["highlights"][1] == "只要有数据，它就能变成视频"


def test_extract_tolerates_curly_quote_delimiter_inside_fence() -> None:
    output = (
        "```json\n"
        '{"highlights": ["第一段。", "第二段。"]}\n'
        "```"
    ).replace('"第一段', "\u201c第一段", 1)
    parsed = extract_json_from_llm_output(output)
    assert parsed is not None
    assert parsed["highlights"] == ["第一段。", "第二段。"]


def test_extract_tolerates_leading_bom() -> None:
    output = "\ufeff" + '{"a": 1}'
    assert extract_json_from_llm_output(output) == {"a": 1}


def test_extract_returns_none_for_empty_or_invalid_output() -> None:
    assert extract_json_from_llm_output("") is None
    assert extract_json_from_llm_output("not json at all") is None
    assert extract_json_from_llm_output("```json\n{broken\n```") is None
