from __future__ import annotations

import json
import re


def extract_json_from_llm_output(output: str) -> object | None:
    if not output:
        return None
    candidates = [output.lstrip("\ufeff")]
    match = re.search(r"```(?:json)?\s*(.*?)\s*```", output, re.DOTALL)
    if match:
        candidates.append(match.group(1))
    for candidate in candidates:
        parsed = _try_loads(candidate)
        if parsed is not None:
            return parsed
        # Some reasoning models (observed with DeepSeek-V3.2) occasionally use
        # Chinese curly quotes (U+201C/U+201D) in place of structural double
        # quotes, which breaks json.loads. Normalize and retry as a fallback.
        normalized = candidate.replace("\u201c", '"').replace("\u201d", '"')
        if normalized != candidate:
            parsed = _try_loads(normalized)
            if parsed is not None:
                return parsed
    return None


def _try_loads(value: str) -> object | None:
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return None
