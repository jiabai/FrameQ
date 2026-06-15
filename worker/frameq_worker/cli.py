from __future__ import annotations

import argparse
import json
from collections.abc import Sequence

from frameq_worker.models import JobStage, ProcessRequest, ProcessResult, WorkerError


def run_worker_once(request_json: str) -> dict[str, object]:
    try:
        payload = json.loads(request_json)
    except json.JSONDecodeError:
        return ProcessResult(
            status=JobStage.FAILED,
            error=WorkerError(
                code="INVALID_REQUEST_JSON",
                message="Request payload must be valid JSON.",
                stage=JobStage.WAITING_INPUT,
            ),
        ).to_dict()

    ProcessRequest(url=payload["url"])

    return ProcessResult(
        status=JobStage.FAILED,
        error=WorkerError(
            code="WORKER_PIPELINE_NOT_IMPLEMENTED",
            message="FrameQ worker pipeline is not implemented yet.",
            stage=JobStage.VIDEO_EXTRACTING,
        ),
    ).to_dict()


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run one FrameQ worker request.")
    parser.add_argument("--request-json", required=True, help="Serialized ProcessRequest payload.")
    args = parser.parse_args(argv)

    result = run_worker_once(args.request_json)
    print(json.dumps(result, ensure_ascii=False))
    return 0
