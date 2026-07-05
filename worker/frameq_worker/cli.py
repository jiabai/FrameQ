from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path

from frameq_worker import pipeline as pipeline_module
from frameq_worker import worker_service as worker_service_module
from frameq_worker.asr import DEFAULT_ASR_MODEL, build_asr_transcriber
from frameq_worker.desktop_contract import (
    ASR_MODEL_ENV,
    CACHE_DIR_ENV,
    MODEL_DIR_ENV,
    MODEL_DOWNLOAD_EVENT_PREFIX,
    MODEL_DOWNLOAD_SHA256_ENV,
    MODEL_DOWNLOAD_URL_ENV,
    MODELSCOPE_ENDPOINT_ENV,
    OUTPUT_DIR_ENV,
    PROGRESS_EVENT_PREFIX,
    SENSEVOICE_REVISION_ENV,
    ProgressCallback,
)
from frameq_worker.llm import build_insight_client_from_env
from frameq_worker.pipeline import (
    VIDEO_SUFFIXES,
    can_reuse_audio,
    emit_progress,
    failed_result,
    find_latest_video,
    find_new_or_updated_video,
    find_video_by_stem,
    resolve_cache_dir,
    resolve_output_dir,
    run_worker_pipeline,
    snapshot_video_files,
)
from frameq_worker.requests import (
    optional_env as _optional_env,
)
from frameq_worker.requests import (
    parse_process_request,
    parse_retry_insights_request,
    resolve_configured_asr_model,
)
from frameq_worker.worker_service import (
    failed_insight_retry_result,
    run_asr_model_download_once,
    should_allow_real_asr,
)

__all__ = [
    "ASR_MODEL_ENV",
    "CACHE_DIR_ENV",
    "DEFAULT_ASR_MODEL",
    "MODEL_DIR_ENV",
    "MODEL_DOWNLOAD_EVENT_PREFIX",
    "MODEL_DOWNLOAD_SHA256_ENV",
    "MODEL_DOWNLOAD_URL_ENV",
    "MODELSCOPE_ENDPOINT_ENV",
    "OUTPUT_DIR_ENV",
    "PROGRESS_EVENT_PREFIX",
    "ProgressCallback",
    "SENSEVOICE_REVISION_ENV",
    "VIDEO_SUFFIXES",
    "_optional_env",
    "build_asr_transcriber",
    "build_insight_client_from_env",
    "can_reuse_audio",
    "emit_progress",
    "failed_insight_retry_result",
    "failed_result",
    "find_latest_video",
    "find_new_or_updated_video",
    "find_video_by_stem",
    "main",
    "parse_process_request",
    "parse_retry_insights_request",
    "render_model_download_event",
    "render_progress_event",
    "render_result_json",
    "resolve_cache_dir",
    "resolve_configured_asr_model",
    "resolve_output_dir",
    "retry_insights_once",
    "run_asr_model_download_once",
    "run_worker_once",
    "run_worker_pipeline",
    "should_allow_real_asr",
    "snapshot_video_files",
]


def run_worker_once(*args: object, **kwargs: object) -> dict[str, object]:
    pipeline_module.build_asr_transcriber = build_asr_transcriber
    worker_service_module.build_insight_client_from_env = build_insight_client_from_env
    return worker_service_module.run_worker_once(*args, **kwargs)


def retry_insights_once(*args: object, **kwargs: object) -> dict[str, object]:
    worker_service_module.build_insight_client_from_env = build_insight_client_from_env
    return worker_service_module.retry_insights_once(*args, **kwargs)


def render_result_json(result: dict[str, object]) -> str:
    return json.dumps(result, ensure_ascii=True)


def render_progress_event(event: dict[str, object]) -> str:
    return f"{PROGRESS_EVENT_PREFIX}{json.dumps(event, ensure_ascii=True)}"


def render_model_download_event(event: dict[str, object]) -> str:
    return f"{MODEL_DOWNLOAD_EVENT_PREFIX}{json.dumps(event, ensure_ascii=True)}"


def print_progress_event(event: dict[str, object]) -> None:
    print(render_progress_event(event), file=sys.stderr, flush=True)


def print_model_download_event(event: dict[str, object]) -> None:
    print(render_model_download_event(event), file=sys.stderr, flush=True)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run one FrameQ worker request.")
    request_group = parser.add_mutually_exclusive_group(required=True)
    request_group.add_argument("--request-json", help="Serialized ProcessRequest payload.")
    request_group.add_argument(
        "--retry-insights-json",
        help="Serialized RetryInsightsRequest payload.",
    )
    request_group.add_argument(
        "--download-asr-model",
        action="store_true",
        help="Download the release ASR model cache into FRAMEQ_MODEL_DIR.",
    )
    args = parser.parse_args(argv)

    is_model_download = args.download_asr_model
    if is_model_download:
        result = run_asr_model_download_once(
            project_root=Path.cwd(),
            progress_callback=print_model_download_event,
        )
    elif args.retry_insights_json:
        result = retry_insights_once(args.retry_insights_json, project_root=Path.cwd())
    else:
        result = run_worker_once(
            args.request_json,
            project_root=Path.cwd(),
            progress_callback=print_progress_event,
        )
    print(render_result_json(result))
    return 1 if is_model_download and result.get("status") == "failed" else 0
