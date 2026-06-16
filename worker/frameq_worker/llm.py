from __future__ import annotations

import json
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from urllib.request import Request

from frameq_worker.insightflow import InsightClient, InsightGenerationError

DEFAULT_LLM_BASE_URL = "https://api.openai.com/v1"
DEFAULT_LLM_TIMEOUT_SECONDS = 60.0
DEFAULT_LLM_TEMPERATURE = 0.2

LLM_PROVIDER_ENV = "FRAMEQ_LLM_PROVIDER"
LLM_API_KEY_ENV = "FRAMEQ_LLM_API_KEY"
LLM_MODEL_ENV = "FRAMEQ_LLM_MODEL"
LLM_BASE_URL_ENV = "FRAMEQ_LLM_BASE_URL"
LLM_TIMEOUT_ENV = "FRAMEQ_LLM_TIMEOUT_SECONDS"

Transport = Callable[[Request, float], bytes]


@dataclass(frozen=True)
class OpenAICompatibleInsightClient:
    api_key: str
    model: str
    base_url: str = DEFAULT_LLM_BASE_URL
    timeout_seconds: float = DEFAULT_LLM_TIMEOUT_SECONDS
    temperature: float = DEFAULT_LLM_TEMPERATURE
    transport: Transport | None = None

    def generate(self, prompt: str) -> str:
        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": self.temperature,
        }
        request = Request(
            url=f"{self.base_url.rstrip('/')}/chat/completions",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )

        try:
            raw_response = (self.transport or urlopen_transport)(
                request,
                self.timeout_seconds,
            )
        except urllib.error.HTTPError as exc:
            raise InsightGenerationError(
                "INSIGHTFLOW_LLM_REQUEST_FAILED",
                f"LLM request failed with HTTP {exc.code}.",
            ) from exc
        except (OSError, TimeoutError, urllib.error.URLError) as exc:
            raise InsightGenerationError(
                "INSIGHTFLOW_LLM_REQUEST_FAILED",
                "LLM request failed before a usable response was returned.",
            ) from exc

        return extract_chat_completion_content(raw_response)


def build_insight_client_from_env(env: Mapping[str, str]) -> InsightClient | None:
    api_key = env.get(LLM_API_KEY_ENV, "").strip()
    model = env.get(LLM_MODEL_ENV, "").strip()
    if not api_key or not model:
        return None

    provider = env.get(LLM_PROVIDER_ENV, "openai_compatible").strip().lower()
    if provider not in {"openai", "openai_compatible"}:
        return None

    return OpenAICompatibleInsightClient(
        api_key=api_key,
        model=model,
        base_url=env.get(LLM_BASE_URL_ENV, DEFAULT_LLM_BASE_URL).strip()
        or DEFAULT_LLM_BASE_URL,
        timeout_seconds=parse_timeout(env.get(LLM_TIMEOUT_ENV)),
    )


def parse_timeout(raw_value: str | None) -> float:
    if raw_value is None:
        return DEFAULT_LLM_TIMEOUT_SECONDS

    try:
        timeout = float(raw_value)
    except ValueError:
        return DEFAULT_LLM_TIMEOUT_SECONDS

    return timeout if timeout > 0 else DEFAULT_LLM_TIMEOUT_SECONDS


def urlopen_transport(request: Request, timeout: float) -> bytes:
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def extract_chat_completion_content(raw_response: bytes) -> str:
    try:
        payload = json.loads(raw_response.decode("utf-8"))
        choices = payload["choices"]
        content = choices[0]["message"]["content"]
    except (KeyError, IndexError, TypeError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise InsightGenerationError(
            "INSIGHTFLOW_LLM_INVALID_RESPONSE",
            "LLM response did not contain a usable chat completion message.",
        ) from exc

    if not isinstance(content, str) or not content.strip():
        raise InsightGenerationError(
            "INSIGHTFLOW_LLM_INVALID_RESPONSE",
            "LLM response did not contain a usable chat completion message.",
        )

    return content
