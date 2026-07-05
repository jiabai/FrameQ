from frameq_worker.models import JobStage, ProcessRequest, ProcessResult, WorkerError


def test_process_request_uses_mvp_defaults() -> None:
    request = ProcessRequest(url="https://www.douyin.com/video/7524373044106677544")

    assert request.language == "Chinese"
    assert request.output_formats == ("txt", "md")
    assert request.model == "iic/SenseVoiceSmall"
    assert request.generate_insights is True
    assert request.insightflow_mode == "embedded"


def test_process_result_serializes_task_artifacts_text_and_insights() -> None:
    result = ProcessResult(
        status=JobStage.COMPLETED,
        task_id="20260705-153012-douyin-7524373044106677544",
        task_dir="outputs/tasks/20260705-153012-douyin-7524373044106677544",
        artifacts={
            "video": "media/video.mp4",
            "audio": "media/audio.wav",
            "transcript_txt": "transcript/transcript.txt",
            "transcript_md": "transcript/transcript.md",
            "segments": "transcript/segments.json",
            "summary": "ai/summary.md",
            "mindmap": "ai/mindmap.mmd",
            "insights": "ai/insights.json",
        },
        text="transcript",
        summary="# summary",
        insights=["question"],
    )

    assert result.to_dict() == {
        "status": "completed",
        "task_id": "20260705-153012-douyin-7524373044106677544",
        "task_dir": "outputs/tasks/20260705-153012-douyin-7524373044106677544",
        "artifacts": {
            "video": "media/video.mp4",
            "audio": "media/audio.wav",
            "transcript_txt": "transcript/transcript.txt",
            "transcript_md": "transcript/transcript.md",
            "segments": "transcript/segments.json",
            "summary": "ai/summary.md",
            "mindmap": "ai/mindmap.mmd",
            "insights": "ai/insights.json",
        },
        "text": "transcript",
        "summary": "# summary",
        "insights": ["question"],
        "error": None,
    }


def test_partial_result_keeps_task_artifacts_and_structured_error() -> None:
    result = ProcessResult(
        status=JobStage.PARTIAL_COMPLETED,
        task_id="20260705-153012-douyin-demo",
        task_dir="outputs/tasks/20260705-153012-douyin-demo",
        artifacts={"transcript_txt": "transcript/transcript.txt"},
        text="finished transcript",
        error=WorkerError(
            code="INSIGHTFLOW_CONFIG_MISSING",
            message="InsightFlow LLM configuration is missing.",
            stage=JobStage.INSIGHTS_GENERATING,
        ),
    )

    serialized = result.to_dict()

    assert serialized["status"] == "partial_completed"
    assert serialized["task_id"] == "20260705-153012-douyin-demo"
    assert serialized["artifacts"] == {"transcript_txt": "transcript/transcript.txt"}
    assert serialized["text"] == "finished transcript"
    assert serialized["error"] == {
        "code": "INSIGHTFLOW_CONFIG_MISSING",
        "message": "InsightFlow LLM configuration is missing.",
        "stage": "insights_generating",
    }
