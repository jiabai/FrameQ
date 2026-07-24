from __future__ import annotations

import inspect
import json
from types import SimpleNamespace

import frameq_worker.platform_source_resolvers as platform_resolvers_module
import frameq_worker.worker_service as worker_service
import pytest
from frameq_worker.source_identity import identify_source
from frameq_worker.source_resolution import SourceRequest

EXPECTED_SIGNATURES = {
    "run_worker_once": (
        "request_json",
        "project_root",
        "command_runner",
        "transcriber",
        "transcriber_factory",
        "allow_real_asr",
        "environ",
        "progress_callback",
        "source_request_resolver",
    ),
    "run_local_media_once": (
        "request_json",
        "project_root",
        "command_runner",
        "transcriber",
        "transcriber_factory",
        "allow_real_asr",
        "environ",
        "progress_callback",
    ),
    "resolve_source_identity_once": (
        "request_json",
        "source_request_resolver",
    ),
    "retry_insights_once": (
        "request_json",
        "project_root",
        "insight_client",
        "insight_client_factory",
        "environ",
    ),
    "run_asr_model_download_once": (
        "project_root",
        "environ",
        "progress_callback",
    ),
}

EXPECTED_REQUIRED_PARAMETERS = {
    "run_worker_once": ("request_json",),
    "run_local_media_once": ("request_json",),
    "resolve_source_identity_once": ("request_json",),
    "retry_insights_once": ("request_json",),
    "run_asr_model_download_once": (),
}


def test_worker_service_facade_signatures_are_stable() -> None:
    for name, expected_names in EXPECTED_SIGNATURES.items():
        signature = inspect.signature(getattr(worker_service, name))

        assert tuple(signature.parameters) == expected_names
        assert all(
            parameter.kind is inspect.Parameter.POSITIONAL_OR_KEYWORD
            for parameter in signature.parameters.values()
        )
        assert signature.return_annotation in {
            dict[str, object],
            "dict[str, object]",
        }


def test_worker_service_facade_required_parameters_are_stable() -> None:
    for name, expected_required in EXPECTED_REQUIRED_PARAMETERS.items():
        signature = inspect.signature(getattr(worker_service, name))
        required = tuple(
            parameter.name
            for parameter in signature.parameters.values()
            if parameter.default is inspect.Parameter.empty
        )

        assert required == expected_required


def test_source_identity_facade_uses_platform_aware_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    parsed_sources: list[str] = []

    def fake_parse_bilibili_input(source: str) -> SimpleNamespace:
        parsed_sources.append(source)
        return SimpleNamespace(
            full_url="https://www.bilibili.com/video/BV1Aa411c7mD?p=2"
        )

    monkeypatch.setattr(
        platform_resolvers_module,
        "parse_bilibili_input",
        fake_parse_bilibili_input,
    )

    result = worker_service.resolve_source_identity_once(
        json.dumps({"url": "https://b23.tv/review-short"})
    )

    assert result["status"] == "completed"
    assert result["source_url"] == (
        "https://www.bilibili.com/video/BV1Aa411c7mD?p=2"
    )
    assert parsed_sources == ["https://b23.tv/review-short"]


def test_source_identity_facade_retains_injected_resolver() -> None:
    canonical_url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    calls: list[str] = []

    def injected_resolver(raw_url: str) -> SourceRequest:
        calls.append(raw_url)
        return SourceRequest(raw_url, identify_source(canonical_url))

    result = worker_service.resolve_source_identity_once(
        json.dumps({"url": "https://example.test/injected"}),
        source_request_resolver=injected_resolver,
    )

    assert result["status"] == "completed"
    assert result["source_url"] == canonical_url
    assert calls == ["https://example.test/injected"]
