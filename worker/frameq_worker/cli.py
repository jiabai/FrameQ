from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from io import TextIOBase
from pathlib import Path

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
from frameq_worker.media_preparation import (
    VIDEO_SUFFIXES,
    can_reuse_audio,
    find_latest_video,
    find_new_or_updated_video,
    find_video_by_stem,
    snapshot_video_files,
)
from frameq_worker.pipeline import (
    emit_progress,
    failed_result,
    resolve_cache_dir,
    resolve_output_dir,
    run_worker_pipeline,
)
from frameq_worker.platform_source_resolvers import build_default_source_resolver
from frameq_worker.progress_events import (
    validate_model_progress_event,
    validate_worker_progress_event,
)
from frameq_worker.requests import (
    optional_env as _optional_env,
)
from frameq_worker.requests import (
    parse_process_local_media_request,
    parse_process_request,
    parse_retry_insights_request,
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
    "parse_process_local_media_request",
    "parse_retry_insights_request",
    "render_model_download_event",
    "render_progress_event",
    "render_result_json",
    "resolve_cache_dir",
    "resolve_output_dir",
    "resolve_source_identity_once",
    "retry_insights_once",
    "run_asr_model_download_once",
    "run_local_media_once",
    "run_worker_once",
    "run_worker_pipeline",
    "should_allow_real_asr",
    "snapshot_video_files",
]

MAX_STDIN_REQUEST_BYTES = 1024 * 1024
DEFAULT_SOURCE_RESOLVER = build_default_source_resolver()


class StdinRequestError(ValueError):
    pass


def read_stdin_request(stream: TextIOBase) -> str:
    reader = getattr(stream, "buffer", stream)
    raw = reader.read(MAX_STDIN_REQUEST_BYTES + 1)
    if isinstance(raw, bytes):
        if len(raw) > MAX_STDIN_REQUEST_BYTES:
            raise StdinRequestError
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise StdinRequestError from exc
    else:
        if len(raw.encode("utf-8")) > MAX_STDIN_REQUEST_BYTES:
            raise StdinRequestError
        text = raw
    if not text.strip():
        raise StdinRequestError
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise StdinRequestError from exc
    if not isinstance(payload, dict):
        raise StdinRequestError
    return json.dumps(payload, ensure_ascii=True)


def stdin_failure_result(mode: str) -> dict[str, object]:
    if mode == "resolve_source_identity":
        return {
            "status": "failed",
            "error": {"code": "WORKER_STDIN_INVALID"},
        }
    stage = "insights_generating" if mode == "retry_insights" else "waiting_input"
    return {
        "status": "failed",
        "task_id": None,
        "task_dir": None,
        "artifacts": {},
        "text": "",
        "summary": "",
        "insights": [],
        "transcript": None,
        "error": {
            "code": "WORKER_STDIN_INVALID",
            "message": "Worker request stdin was invalid.",
            "stage": stage,
        },
    }


def run_worker_once(*args: object, **kwargs: object) -> dict[str, object]:
    kwargs.setdefault("transcriber_factory", build_asr_transcriber)
    kwargs.setdefault(
        "source_request_resolver",
        DEFAULT_SOURCE_RESOLVER.resolve_request,
    )
    return worker_service_module.run_worker_once(*args, **kwargs)


def run_local_media_once(*args: object, **kwargs: object) -> dict[str, object]:
    kwargs.setdefault("transcriber_factory", build_asr_transcriber)
    return worker_service_module.run_local_media_once(*args, **kwargs)


def resolve_source_identity_once(*args: object, **kwargs: object) -> dict[str, object]:
    kwargs.setdefault(
        "source_request_resolver",
        DEFAULT_SOURCE_RESOLVER.resolve_request,
    )
    return worker_service_module.resolve_source_identity_once(*args, **kwargs)


def retry_insights_once(*args: object, **kwargs: object) -> dict[str, object]:
    kwargs.setdefault("insight_client_factory", build_insight_client_from_env)
    return worker_service_module.retry_insights_once(*args, **kwargs)


def render_result_json(result: dict[str, object]) -> str:
    return json.dumps(result, ensure_ascii=True)


def render_progress_event(event: dict[str, object]) -> str:
    validated = validate_worker_progress_event(event)
    return f"{PROGRESS_EVENT_PREFIX}{json.dumps(validated, ensure_ascii=True)}"


def render_model_download_event(event: dict[str, object]) -> str:
    validated = validate_model_progress_event(event)
    return f"{MODEL_DOWNLOAD_EVENT_PREFIX}{json.dumps(validated, ensure_ascii=True)}"


def print_progress_event(event: dict[str, object]) -> None:
    print(render_progress_event(event), file=sys.stderr, flush=True)


def print_model_download_event(event: dict[str, object]) -> None:
    print(render_model_download_event(event), file=sys.stderr, flush=True)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run one FrameQ worker request.")
    request_group = parser.add_mutually_exclusive_group(required=True)
    request_group.add_argument(
        "--request-stdin",
        action="store_true",
        help="Read one ProcessRequest JSON object from stdin.",
    )
    request_group.add_argument(
        "--retry-insights-stdin",
        action="store_true",
        help="Read one RetryInsightsRequest JSON object from stdin.",
    )
    request_group.add_argument(
        "--process-local-media-stdin",
        action="store_true",
        help="Read one ProcessLocalMediaRequest JSON object from stdin.",
    )
    request_group.add_argument(
        "--download-asr-model",
        action="store_true",
        help="Download the release ASR model cache into FRAMEQ_MODEL_DIR.",
    )
    request_group.add_argument(
        "--resolve-source-stdin",
        action="store_true",
        help="Read one source-identity request JSON object from stdin.",
    )
    args = parser.parse_args(argv)

    is_model_download = args.download_asr_model
    stdin_mode = next(
        (
            mode
            for enabled, mode in [
                (args.request_stdin, "process_video"),
                (args.process_local_media_stdin, "process_local_media"),
                (args.retry_insights_stdin, "retry_insights"),
                (args.resolve_source_stdin, "resolve_source_identity"),
            ]
            if enabled
        ),
        None,
    )
    request_json: str | None = None
    if stdin_mode is not None:
        try:
            request_json = read_stdin_request(sys.stdin)
        except (OSError, StdinRequestError):
            print(render_result_json(stdin_failure_result(stdin_mode)))
            return 1
    if is_model_download:
        result = run_asr_model_download_once(
            project_root=Path.cwd(),
            progress_callback=print_model_download_event,
        )
    elif args.process_local_media_stdin:
        result = run_local_media_once(
            request_json or "{}",
            project_root=Path.cwd(),
            progress_callback=print_progress_event,
        )
    elif args.retry_insights_stdin:
        result = retry_insights_once(request_json or "{}", project_root=Path.cwd())
    elif args.resolve_source_stdin:
        result = resolve_source_identity_once(request_json or "{}")
    else:
        result = run_worker_once(
            request_json or "{}",
            project_root=Path.cwd(),
            progress_callback=print_progress_event,
        )
    print(render_result_json(result))
    return 1 if is_model_download and result.get("status") == "failed" else 0
