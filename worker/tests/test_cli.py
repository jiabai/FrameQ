import json

from frameq_worker.cli import run_worker_once


def test_run_worker_once_returns_structured_not_implemented_result() -> None:
    result = run_worker_once(
        json.dumps({"url": "https://www.douyin.com/video/7524373044106677544"})
    )

    assert result["status"] == "failed"
    assert result["error"] == {
        "code": "WORKER_PIPELINE_NOT_IMPLEMENTED",
        "message": "FrameQ worker pipeline is not implemented yet.",
        "stage": "video_extracting",
    }
    assert result["text"] == ""
    assert result["insights"] == []


def test_run_worker_once_rejects_invalid_json_with_structured_error() -> None:
    result = run_worker_once("{bad json")

    assert result["status"] == "failed"
    assert result["error"] == {
        "code": "INVALID_REQUEST_JSON",
        "message": "Request payload must be valid JSON.",
        "stage": "waiting_input",
    }
