from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import pytest
from frameq_worker import media
from frameq_worker.bilibili_fallback import (
    BilibiliFallbackError,
    parse_bilibili_input,
)
from frameq_worker.bilibili_fallback import (
    HttpResponse as BilibiliHttpResponse,
)
from frameq_worker.douyin_fallback import (
    HttpResponse as DouyinHttpResponse,
)
from frameq_worker.douyin_fallback import (
    resolve_aweme_id_from_input,
)
from frameq_worker.xiaohongshu_fallback import (
    HttpResponse as XiaohongshuHttpResponse,
)
from frameq_worker.xiaohongshu_fallback import (
    XiaohongshuFallbackError,
    parse_xiaohongshu_input,
)

CONTRACT_PATH = Path(__file__).parents[2] / "contracts" / "platform-url-support-contract.json"


def load_contract() -> dict[str, Any]:
    return json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))


class FixtureHttpClient:
    def __init__(self, expected_url: str | None, response: object | None) -> None:
        self.expected_url = expected_url
        self.response = response
        self.calls: list[str] = []

    def get(
        self,
        url: str,
        headers: dict[str, str] | None = None,
        timeout_seconds: float = 10.0,
    ) -> object:
        del headers, timeout_seconds
        self.calls.append(url)
        if self.expected_url is None or self.response is None:
            raise AssertionError(f"Unexpected network access: {url}")
        assert url == self.expected_url
        return self.response


def build_http_client(platform: str, parser_contract: Mapping[str, Any]) -> FixtureHttpClient:
    response_contract = parser_contract.get("shortLinkResponse")
    if not isinstance(response_contract, Mapping):
        return FixtureHttpClient(None, None)

    request_url = str(response_contract["requestUrl"])
    response_url = str(response_contract["responseUrl"])
    status = int(response_contract["status"])
    headers = {
        str(key): str(value)
        for key, value in dict(response_contract.get("headers", {})).items()
    }
    body = str(response_contract.get("body", "")).encode()
    response_types = {
        "douyin": DouyinHttpResponse,
        "xiaohongshu": XiaohongshuHttpResponse,
        "bilibili": BilibiliHttpResponse,
    }
    response_type = response_types[platform]
    response = response_type(status=status, headers=headers, body=body, url=response_url)
    return FixtureHttpClient(request_url, response)


def worker_dispatches(contract_case: Mapping[str, Any]) -> bool:
    platform = str(contract_case["platform"])
    raw_input = str(contract_case["input"])
    worker_contract = contract_case["worker"]
    assert isinstance(worker_contract, Mapping)
    failure_message = worker_contract.get("failureMessage")

    if platform == "douyin":
        return media.should_attempt_douyin_fallback(raw_input, str(failure_message or ""))
    if platform == "xiaohongshu":
        return media.should_attempt_xiaohongshu_fallback(
            raw_input,
            str(failure_message or ""),
        )
    if platform == "bilibili":
        return media.should_attempt_bilibili_fallback(raw_input, str(failure_message or ""))
    if platform == "youtube":
        return media.should_attempt_youtube_processing(raw_input)
    raise AssertionError(f"Unsupported contract platform: {platform}")


def parse_fallback_input(
    platform: str,
    raw_input: str,
    parser_contract: Mapping[str, Any],
) -> str:
    client = build_http_client(platform, parser_contract)
    if platform == "douyin":
        media_id = resolve_aweme_id_from_input(raw_input, http_client=client)
    elif platform == "xiaohongshu":
        media_id = parse_xiaohongshu_input(raw_input, http_client=client).note_id
    elif platform == "bilibili":
        media_id = parse_bilibili_input(raw_input, http_client=client).video_id
    else:
        raise AssertionError(f"Platform has no fallback parser: {platform}")

    assert media_id is not None
    expected_calls = 1 if parser_contract.get("shortLinkResponse") else 0
    assert len(client.calls) == expected_calls
    return media_id


def test_contract_is_drift_only_and_freezes_all_known_asymmetries() -> None:
    contract = load_contract()
    referenced_asymmetries = {
        contract_case["knownAsymmetry"]
        for contract_case in contract["cases"]
        if contract_case["knownAsymmetry"] is not None
    }

    assert contract["schemaVersion"] == 2
    assert contract["intent"] == "drift-detection-only"
    assert contract["networkPolicy"] == "fake-clients-only"
    assert referenced_asymmetries == set(contract["knownAsymmetries"])
    for contract_case in contract["cases"]:
        worker_contract = contract_case["worker"]
        layer_support = [
            contract_case["frontend"]["canSubmit"],
            worker_contract["dispatch"],
        ]
        parser_contract = worker_contract["parser"]
        if parser_contract is not None:
            layer_support.append(parser_contract["outcome"] == "accepted")
        has_layer_disagreement = len(set(layer_support)) > 1
        assert (contract_case["knownAsymmetry"] is not None) is has_layer_disagreement


@pytest.mark.parametrize(
    "contract_case",
    load_contract()["cases"],
    ids=lambda contract_case: contract_case["id"],
)
def test_worker_dispatch_and_fallback_parser_match_contract(
    contract_case: Mapping[str, Any],
) -> None:
    worker_contract = contract_case["worker"]
    assert isinstance(worker_contract, Mapping)
    assert worker_dispatches(contract_case) is worker_contract["dispatch"]

    parser_contract = worker_contract["parser"]
    if parser_contract is None:
        return
    assert isinstance(parser_contract, Mapping)

    platform = str(contract_case["platform"])
    raw_input = str(contract_case["input"])
    if parser_contract["outcome"] == "accepted":
        actual_media_id = parse_fallback_input(platform, raw_input, parser_contract)
        assert actual_media_id == parser_contract["mediaId"]
        return

    error_types = (BilibiliFallbackError, XiaohongshuFallbackError)
    with pytest.raises(error_types):
        parse_fallback_input(platform, raw_input, parser_contract)
