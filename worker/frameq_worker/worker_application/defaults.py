from __future__ import annotations

import os

from frameq_worker.asr import build_asr_transcriber as build_asr_transcriber
from frameq_worker.llm import (
    build_insight_client_from_env as build_insight_client_from_env,
)
from frameq_worker.platform_source_resolvers import build_default_source_resolver

DEFAULT_SOURCE_RESOLVER = build_default_source_resolver()


def should_allow_real_asr(environ: dict[str, str] | None = None) -> bool:
    env = environ if environ is not None else os.environ
    return env.get("FRAMEQ_ALLOW_REAL_ASR") == "1"
