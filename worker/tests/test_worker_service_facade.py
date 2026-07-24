from __future__ import annotations

import inspect

import frameq_worker.worker_service as worker_service

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
