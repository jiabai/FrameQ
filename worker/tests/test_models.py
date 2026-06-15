from frameq_worker.models import JobStage, ProcessRequest, ProcessResult, WorkerError


def test_process_request_uses_mvp_defaults() -> None:
    request = ProcessRequest(url="https://www.douyin.com/video/7524373044106677544")

    assert request.language == "Chinese"
    assert request.output_formats == ("txt", "md")
    assert request.model == "Qwen/Qwen3-ASR-0.6B"
    assert request.generate_insights is True
    assert request.insightflow_mode == "embedded"


def test_process_result_serializes_paths_text_and_insights() -> None:
    result = ProcessResult(
        status=JobStage.COMPLETED,
        video_path="outputs/7524373044106677544.mp4",
        audio_path="work/7524373044106677544.wav",
        transcript_path="outputs/7524373044106677544_transcript.txt",
        insights_path="outputs/7524373044106677544_insights.json",
        text="示例文字稿",
        insights=["什么能力才是真正的价值分水岭？"],
    )

    assert result.to_dict() == {
        "status": "completed",
        "video_path": "outputs/7524373044106677544.mp4",
        "audio_path": "work/7524373044106677544.wav",
        "transcript_path": "outputs/7524373044106677544_transcript.txt",
        "insights_path": "outputs/7524373044106677544_insights.json",
        "text": "示例文字稿",
        "insights": ["什么能力才是真正的价值分水岭？"],
        "error": None,
    }


def test_partial_result_keeps_transcript_and_structured_error() -> None:
    result = ProcessResult(
        status=JobStage.PARTIAL_COMPLETED,
        transcript_path="outputs/demo_transcript.txt",
        text="已经完成的文字稿",
        error=WorkerError(
            code="INSIGHTFLOW_CONFIG_MISSING",
            message="InsightFlow LLM configuration is missing.",
            stage=JobStage.INSIGHTS_GENERATING,
        ),
    )

    serialized = result.to_dict()

    assert serialized["status"] == "partial_completed"
    assert serialized["text"] == "已经完成的文字稿"
    assert serialized["error"] == {
        "code": "INSIGHTFLOW_CONFIG_MISSING",
        "message": "InsightFlow LLM configuration is missing.",
        "stage": "insights_generating",
    }
