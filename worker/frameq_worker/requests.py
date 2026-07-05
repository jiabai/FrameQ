from __future__ import annotations

from frameq_worker.asr import DEFAULT_ASR_MODEL, resolve_asr_model_name
from frameq_worker.desktop_contract import ASR_MODEL_ENV
from frameq_worker.models import ProcessRequest, RetryInsightsRequest


def parse_process_request(payload: object) -> ProcessRequest:
    if not isinstance(payload, dict):
        raise ValueError("Request payload must be a JSON object.")

    url = payload.get("url")
    if not isinstance(url, str) or not url.strip():
        raise ValueError("Request payload must include a non-empty url.")

    output_formats = payload.get("output_formats", ("txt", "md"))
    if not isinstance(output_formats, list | tuple) or not all(
        isinstance(item, str) for item in output_formats
    ):
        raise ValueError("Request payload output_formats must be a list of strings.")

    return ProcessRequest(
        url=url.strip(),
        language=str(payload.get("language", "Chinese")),
        output_formats=tuple(output_formats),
        model=str(payload.get("model", DEFAULT_ASR_MODEL)),
        generate_insights=bool(payload.get("generate_insights", True)),
        insightflow_mode=str(payload.get("insightflow_mode", "embedded")),
    )


def parse_retry_insights_request(payload: object) -> RetryInsightsRequest:
    if not isinstance(payload, dict):
        raise ValueError("Retry payload must be a JSON object.")

    task_id = payload.get("task_id")
    if not isinstance(task_id, str) or not task_id.strip():
        raise ValueError("Retry payload must include a non-empty task_id.")

    return RetryInsightsRequest(task_id=task_id.strip())


def resolve_configured_asr_model(
    request_model: str,
    environ: dict[str, str] | None = None,
) -> str:
    env = environ if environ is not None else {}
    configured_model = env.get(ASR_MODEL_ENV, "").strip()
    return resolve_asr_model_name(configured_model or request_model)


def optional_env(env: dict[str, str], key: str) -> str | None:
    value = env.get(key, "").strip()
    return value or None
