from __future__ import annotations

import gzip
import json
import re
import zlib
from collections.abc import Mapping

import brotli

from frameq_worker.xiaohongshu.types import HttpResponse, XiaohongshuFallbackError

XHS_MAX_HTML_BYTES = 10 * 1024 * 1024


def raise_for_page_response(response: HttpResponse) -> None:
    if response.status == 404:
        raise XiaohongshuFallbackError(
            "XHS_NOTE_NOT_FOUND",
            "Xiaohongshu note was not found.",
        )
    if response.status in {401, 403}:
        raise XiaohongshuFallbackError(
            "XHS_NOTE_BLOCKED",
            "Xiaohongshu note requires login or is not public.",
        )
    if response.status == 429:
        raise XiaohongshuFallbackError(
            "XHS_RATE_LIMITED",
            "Xiaohongshu request was rate limited.",
        )
    if response.status < 200 or response.status >= 300 or not response.body:
        raise XiaohongshuFallbackError(
            "XHS_PAGE_UNAVAILABLE",
            "Xiaohongshu public note page was unavailable.",
        )


def decode_response_body(
    response: HttpResponse,
    max_bytes: int = XHS_MAX_HTML_BYTES,
) -> str:
    body = response.body
    encoding = (
        (_header(response.headers, "Content-Encoding") or "")
        .split(",", 1)[0]
        .strip()
        .lower()
    )
    try:
        if encoding == "gzip":
            body = gzip.decompress(body)
        elif encoding == "br":
            body = brotli.decompress(body)
        elif encoding == "deflate":
            try:
                body = zlib.decompress(body)
            except zlib.error:
                body = zlib.decompress(body, -zlib.MAX_WBITS)
    except (OSError, brotli.error, zlib.error) as exc:
        raise XiaohongshuFallbackError(
            "XHS_RESPONSE_DECODE_FAILED",
            "Xiaohongshu response body could not be decoded.",
        ) from exc

    if len(body) > max_bytes:
        raise XiaohongshuFallbackError(
            "XHS_RESPONSE_TOO_LARGE",
            "Xiaohongshu page response exceeded the safety limit.",
        )
    return body.decode("utf-8", errors="replace")


def extract_initial_state(body: str) -> dict[str, object]:
    if "error_code" in body or "当前笔记暂时无法浏览" in body:
        raise XiaohongshuFallbackError(
            "XHS_NOTE_BLOCKED",
            "Xiaohongshu note requires login or is not public.",
        )

    marker_index = body.find("window.__INITIAL_STATE__")
    if marker_index < 0:
        raise XiaohongshuFallbackError(
            "XHS_INITIAL_STATE_MISSING",
            "Xiaohongshu page did not include initial state.",
        )

    json_start = body.find("{", marker_index)
    if json_start < 0:
        raise XiaohongshuFallbackError(
            "XHS_INITIAL_STATE_MISSING",
            "Xiaohongshu initial state was not parseable.",
        )

    json_text = js_to_json(extract_braced_object(body, json_start))
    try:
        state = json.loads(json_text)
    except json.JSONDecodeError as exc:
        raise XiaohongshuFallbackError(
            "XHS_INITIAL_STATE_MALFORMED",
            "Xiaohongshu initial state was malformed.",
        ) from exc
    if not isinstance(state, dict):
        raise XiaohongshuFallbackError(
            "XHS_INITIAL_STATE_MALFORMED",
            "Xiaohongshu initial state was not an object.",
        )
    return state


def extract_braced_object(text: str, start_index: int) -> str:
    depth = 0
    in_string = False
    escape = False
    for index in range(start_index, len(text)):
        char = text[index]
        if in_string:
            if escape:
                escape = False
                continue
            if char == "\\":
                escape = True
                continue
            if char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start_index : index + 1]

    raise XiaohongshuFallbackError(
        "XHS_INITIAL_STATE_MISSING",
        "Xiaohongshu initial state object was incomplete.",
    )


def js_to_json(raw: str) -> str:
    converted = re.sub(
        r"([:,\[{]\s*)(?:undefined|void\s+0)(\s*[,}\]])",
        r"\1null\2",
        raw,
    )
    converted = re.sub(
        r"([:,\[{]\s*)(?:undefined|void\s+0)(\s*)$",
        r"\1null\2",
        converted,
    )
    return re.sub(r",(\s*[}\]])", r"\1", converted)


def lookup_note(state: Mapping[str, object], note_id: str) -> Mapping[str, object]:
    note = _as_mapping(state.get("note"))
    detail_map = _as_mapping(note.get("noteDetailMap") if note else None)
    entry = _as_mapping(detail_map.get(note_id) if detail_map else None)
    note_obj = _as_mapping(entry.get("note") if entry else None)
    if not note_obj:
        raise XiaohongshuFallbackError(
            "XHS_NOTE_NOT_FOUND",
            "Xiaohongshu note was not found.",
        )
    return note_obj


def is_image_only_note(note_obj: Mapping[str, object]) -> bool:
    note_type = _get_str(note_obj, "type").lower()
    image_list = note_obj.get("imageList")
    return note_type in {"image", "album", "image_album"} or isinstance(
        image_list,
        list,
    )


def _header(headers: Mapping[str, str], name: str) -> str | None:
    lowered = name.lower()
    for key, value in headers.items():
        if key.lower() == lowered:
            return value
    return None


def _as_mapping(value: object) -> Mapping[str, object] | None:
    return value if isinstance(value, Mapping) else None


def _get_str(mapping: Mapping[str, object], key: str) -> str:
    value = mapping.get(key)
    return value.strip() if isinstance(value, str) else ""
