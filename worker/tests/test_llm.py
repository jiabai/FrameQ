import json
from urllib.request import Request

import pytest
from frameq_worker.insightflow import InsightGenerationError
from frameq_worker.llm import (
    OpenAICompatibleInsightClient,
    build_insight_client_from_env,
)


def test_build_insight_client_from_env_requires_key_and_model() -> None:
    assert build_insight_client_from_env({}) is None
    assert build_insight_client_from_env({"FRAMEQ_LLM_API_KEY": "secret"}) is None
    assert build_insight_client_from_env({"FRAMEQ_LLM_MODEL": "demo-model"}) is None


def test_openai_compatible_client_posts_prompt_and_returns_message_content() -> None:
    calls: list[tuple[Request, float]] = []

    def fake_transport(request: Request, timeout: float) -> bytes:
        calls.append((request, timeout))
        return json.dumps(
            {
                "choices": [
                    {
                        "message": {
                            "content": '["为什么配置入口应该和密钥隔离？"]',
                        }
                    }
                ]
            }
        ).encode("utf-8")

    client = OpenAICompatibleInsightClient(
        api_key="secret-key",
        model="demo-model",
        base_url="https://llm.example/v1/",
        timeout_seconds=12,
        transport=fake_transport,
    )

    content = client.generate("请生成话题点")

    request, timeout = calls[0]
    assert content == '["为什么配置入口应该和密钥隔离？"]'
    assert request.full_url == "https://llm.example/v1/chat/completions"
    assert request.get_header("Authorization") == "Bearer secret-key"
    assert request.get_header("Content-type") == "application/json"
    assert timeout == 12
    payload = json.loads(request.data.decode("utf-8"))  # type: ignore[union-attr]
    assert payload == {
        "model": "demo-model",
        "messages": [{"role": "user", "content": "请生成话题点"}],
        "temperature": 0.2,
    }


def test_openai_compatible_client_rejects_unusable_response() -> None:
    client = OpenAICompatibleInsightClient(
        api_key="secret-key",
        model="demo-model",
        transport=lambda request, timeout: b'{"choices": []}',
    )

    with pytest.raises(InsightGenerationError) as exc_info:
        client.generate("请生成话题点")

    assert exc_info.value.code == "INSIGHTFLOW_LLM_INVALID_RESPONSE"
