from __future__ import annotations

import gzip
import html
import json
import re
import urllib.error
import urllib.parse
import urllib.request
import zlib
from collections.abc import Mapping
from dataclasses import dataclass, field
from http.cookiejar import CookieJar
from pathlib import Path

from frameq_worker.download_reliability import SafeDownloadError, write_http_response_atomically

XHS_DESKTOP_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)
XHS_BASE_URL = "https://www.xiaohongshu.com"
XHS_REFERER = "https://www.xiaohongshu.com/"
XHS_URL_PATTERN = re.compile(r"https?://[^\s\"'<>]+", re.IGNORECASE)
XHS_NOTE_ID_EXACT_PATTERN = re.compile(r"(?i)^[0-9a-f]{24}$")
XHS_NOTE_ID_PATTERN = re.compile(r"(?i)[0-9a-f]{24}")
XHS_SHORT_HOSTS = {"xhslink.com", "www.xhslink.com"}
XHS_MAX_HTML_BYTES = 10 * 1024 * 1024
XHS_MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024


class XiaohongshuFallbackError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class HttpResponse:
    status: int
    headers: Mapping[str, str]
    body: bytes
    url: str


@dataclass(frozen=True)
class XiaohongshuParseResult:
    note_id: str
    full_url: str = ""
    xsec_token: str = ""


@dataclass(frozen=True)
class XiaohongshuStreamCandidate:
    quality_key: str
    url: str
    size_bytes: int
    width: int | None = None
    height: int | None = None
    backup_urls: list[str] = field(default_factory=list)
    video_codec: str = ""
    video_bitrate: int = 0
    stream_type: int = 0
    weight: int = 0
    default_stream: int = 0
    headers: dict[str, str] = field(default_factory=dict)


class UrllibXiaohongshuHttpClient:
    def __init__(self, cookie_jar: CookieJar | None = None) -> None:
        self._cookie_jar = cookie_jar or CookieJar()
        self._opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self._cookie_jar)
        )

    def get(
        self,
        url: str,
        headers: dict[str, str] | None = None,
        timeout_seconds: float = 10.0,
    ) -> HttpResponse:
        request = urllib.request.Request(url, headers=headers or {}, method="GET")
        try:
            with self._opener.open(request, timeout=timeout_seconds) as response:
                return HttpResponse(
                    status=response.status,
                    headers=dict(response.headers.items()),
                    body=response.read(),
                    url=response.geturl(),
                )
        except urllib.error.HTTPError as exc:
            return HttpResponse(
                status=exc.code,
                headers=dict(exc.headers.items()),
                body=exc.read(),
                url=exc.geturl(),
            )
        except urllib.error.URLError as exc:
            raise XiaohongshuFallbackError(
                "XHS_PAGE_UNAVAILABLE",
                "Xiaohongshu public page request failed.",
            ) from exc


def parse_xiaohongshu_input(
    raw_input: str,
    http_client: UrllibXiaohongshuHttpClient | None = None,
) -> XiaohongshuParseResult:
    normalized = raw_input.strip()
    if XHS_NOTE_ID_EXACT_PATTERN.fullmatch(normalized):
        return XiaohongshuParseResult(note_id=normalized.lower())

    client = http_client or UrllibXiaohongshuHttpClient()
    for candidate_url in _extract_xhs_urls(normalized):
        parsed = _parse_xhs_note_url(candidate_url)
        if parsed is not None:
            return parsed
        if not _is_xhs_short_link(candidate_url):
            continue

        response = client.get(candidate_url, headers=_page_headers(), timeout_seconds=10.0)
        resolved = _parse_xhs_note_url(response.url)
        if resolved is not None:
            return resolved

        body = _decode_response_body(response)
        for embedded_url in _extract_xhs_urls(body):
            resolved = _parse_xhs_note_url(embedded_url)
            if resolved is not None:
                return resolved

    raise XiaohongshuFallbackError(
        "XHS_ID_PARSE_FAILED",
        "Could not extract Xiaohongshu note ID from input.",
    )


def build_explore_url(
    note_id: str,
    xsec_token: str = "",
    base_url: str = XHS_BASE_URL,
) -> str:
    base = base_url.rstrip("/")
    note_url = f"{base}/explore/{urllib.parse.quote(note_id, safe='')}"
    if xsec_token.strip():
        note_url = f"{note_url}?xsec_token={urllib.parse.quote(xsec_token.strip(), safe='')}"
    return note_url


def parse_video_stream_candidates(
    state: Mapping[str, object],
    note_id: str,
) -> list[XiaohongshuStreamCandidate]:
    note_obj = _lookup_note(state, note_id)
    return _parse_video_streams(note_obj)


def download_xiaohongshu_video(
    raw_input: str,
    output_dir: Path,
    http_client: UrllibXiaohongshuHttpClient | None = None,
    progress_callback: object | None = None,
) -> Path:
    client = http_client or UrllibXiaohongshuHttpClient()
    parsed = parse_xiaohongshu_input(raw_input, http_client=client)

    _emit_progress(progress_callback, "正在解析小红书公开视频页面。", 22)
    page_response = client.get(
        build_explore_url(parsed.note_id, parsed.xsec_token),
        headers=_page_headers(),
        timeout_seconds=10.0,
    )
    _raise_for_page_response(page_response)

    state = _extract_initial_state(_decode_response_body(page_response))
    note_obj = _lookup_note(state, parsed.note_id)
    candidates = _parse_video_streams(note_obj)
    if not candidates:
        if _is_image_only_note(note_obj):
            raise XiaohongshuFallbackError(
                "XHS_IMAGE_ONLY",
                "Xiaohongshu note is image-only and has no playable video.",
            )
        raise XiaohongshuFallbackError(
            "XHS_NO_PLAYABLE_STREAM",
            "Xiaohongshu public note returned no playable video stream.",
        )

    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{parsed.note_id}.mp4"
    _emit_progress(progress_callback, "正在保存小红书公开视频。", 30)
    return _download_first_available_stream(
        candidates,
        output_path=output_path,
        http_client=client,
        progress_callback=progress_callback,
    )


def _download_first_available_stream(
    candidates: list[XiaohongshuStreamCandidate],
    output_path: Path,
    http_client: UrllibXiaohongshuHttpClient,
    progress_callback: object | None = None,
) -> Path:
    last_error: Exception | None = None
    for index, candidate in enumerate(candidates):
        for stream_url in _stream_urls(candidate):
            try:
                response = http_client.get(
                    stream_url,
                    headers=_media_headers(),
                    timeout_seconds=30.0,
                )
                write_http_response_atomically(
                    response,
                    output_path,
                    max_bytes=XHS_MAX_VIDEO_BYTES,
                )
            except (SafeDownloadError, XiaohongshuFallbackError, OSError) as exc:
                last_error = exc
                continue
            return output_path
        _emit_stream_retry(progress_callback, index, candidates)

    raise XiaohongshuFallbackError(
        "XHS_STREAM_DOWNLOAD_FAILED",
        "All Xiaohongshu fallback streams failed to download.",
    ) from last_error


def _stream_urls(candidate: XiaohongshuStreamCandidate) -> list[str]:
    return _collect_download_urls(candidate.url, candidate.backup_urls)


def _extract_xhs_urls(raw_input: str) -> list[str]:
    urls: list[str] = []
    for match in XHS_URL_PATTERN.finditer(html.unescape(raw_input)):
        candidate = match.group(0).rstrip("，。,.、!！?？)")
        parsed = urllib.parse.urlparse(candidate)
        if _is_acceptable_xhs_host(parsed.hostname or ""):
            urls.append(candidate)
    return urls


def _parse_xhs_note_url(raw_url: str) -> XiaohongshuParseResult | None:
    raw_url = html.unescape(raw_url.strip().strip("\"'<>[]{}()"))
    parsed = urllib.parse.urlparse(raw_url)
    if parsed.scheme.lower() not in {"http", "https"}:
        raise XiaohongshuFallbackError(
            "XHS_URL_INVALID",
            "Xiaohongshu URL must use http or https.",
        )

    host = (parsed.hostname or "").lower().rstrip(".")
    if _is_xhs_short_host(host):
        return None
    if not _is_acceptable_xhs_host(host):
        raise XiaohongshuFallbackError("XHS_URL_INVALID", "Unsupported Xiaohongshu host.")

    note_id = _first_note_id(parsed.path)
    query = urllib.parse.parse_qs(parsed.query)
    if note_id is None:
        for values in query.values():
            for value in values:
                note_id = _first_note_id(value)
                if note_id is not None:
                    break
            if note_id is not None:
                break
    if note_id is None:
        raise XiaohongshuFallbackError(
            "XHS_ID_PARSE_FAILED",
            "Could not extract Xiaohongshu note ID from URL.",
        )

    xsec_token = query.get("xsec_token", [""])[0]
    return XiaohongshuParseResult(
        note_id=note_id.lower(),
        full_url=parsed.geturl(),
        xsec_token=xsec_token,
    )


def _first_note_id(value: str) -> str | None:
    match = XHS_NOTE_ID_PATTERN.search(value)
    return match.group(0).lower() if match else None


def _is_xhs_short_link(url: str) -> bool:
    parsed = urllib.parse.urlparse(url)
    return _is_xhs_short_host(parsed.hostname or "")


def _is_xhs_short_host(host: str) -> bool:
    return host.lower().rstrip(".") in XHS_SHORT_HOSTS


def _is_acceptable_xhs_host(host: str) -> bool:
    normalized = host.strip().lower().rstrip(".")
    return (
        normalized == "xiaohongshu.com"
        or normalized.endswith(".xiaohongshu.com")
        or _is_xhs_short_host(normalized)
    )


def _raise_for_page_response(response: HttpResponse) -> None:
    if response.status == 404:
        raise XiaohongshuFallbackError("XHS_NOTE_NOT_FOUND", "Xiaohongshu note was not found.")
    if response.status in {401, 403}:
        raise XiaohongshuFallbackError(
            "XHS_NOTE_BLOCKED",
            "Xiaohongshu note requires login or is not public.",
        )
    if response.status == 429:
        raise XiaohongshuFallbackError("XHS_RATE_LIMITED", "Xiaohongshu request was rate limited.")
    if response.status < 200 or response.status >= 300 or not response.body:
        raise XiaohongshuFallbackError(
            "XHS_PAGE_UNAVAILABLE",
            "Xiaohongshu public note page was unavailable.",
        )


def _decode_response_body(response: HttpResponse) -> str:
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
        elif encoding == "deflate":
            try:
                body = zlib.decompress(body)
            except zlib.error:
                body = zlib.decompress(body, -zlib.MAX_WBITS)
    except (OSError, zlib.error) as exc:
        raise XiaohongshuFallbackError(
            "XHS_RESPONSE_DECODE_FAILED",
            "Xiaohongshu response body could not be decoded.",
        ) from exc

    if len(body) > XHS_MAX_HTML_BYTES:
        raise XiaohongshuFallbackError(
            "XHS_RESPONSE_TOO_LARGE",
            "Xiaohongshu page response exceeded the safety limit.",
        )
    return body.decode("utf-8", errors="replace")


def _extract_initial_state(body: str) -> dict[str, object]:
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

    json_text = _extract_braced_object(body, json_start)
    json_text = _js_to_json(json_text)
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


def _extract_braced_object(text: str, start_index: int) -> str:
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


def _js_to_json(raw: str) -> str:
    converted = re.sub(r"([:,\[{]\s*)(?:undefined|void 0)(\s*[,}\]])", r"\1null\2", raw)
    return re.sub(r",(\s*[}\]])", r"\1", converted)


def _lookup_note(state: Mapping[str, object], note_id: str) -> Mapping[str, object]:
    note = _as_mapping(state.get("note"))
    detail_map = _as_mapping(note.get("noteDetailMap") if note else None)
    entry = _as_mapping(detail_map.get(note_id) if detail_map else None)
    note_obj = _as_mapping(entry.get("note") if entry else None)
    if not note_obj:
        raise XiaohongshuFallbackError("XHS_NOTE_NOT_FOUND", "Xiaohongshu note was not found.")
    return note_obj


def _parse_video_streams(note_obj: Mapping[str, object]) -> list[XiaohongshuStreamCandidate]:
    video = _as_mapping(note_obj.get("video"))
    media = _as_mapping(video.get("media") if video else None)
    stream = media.get("stream") if media else None
    raw_candidates: list[tuple[Mapping[str, object], str]] = []

    if isinstance(stream, list):
        raw_candidates.extend((item, "") for item in stream if isinstance(item, Mapping))
    elif isinstance(stream, Mapping):
        for codec_key, codec_streams in stream.items():
            if isinstance(codec_streams, list):
                raw_candidates.extend(
                    (item, str(codec_key)) for item in codec_streams if isinstance(item, Mapping)
                )

    best_by_key: dict[str, XiaohongshuStreamCandidate] = {}
    for raw_candidate, codec_hint in raw_candidates:
        candidate = _parse_stream_candidate(raw_candidate, codec_hint)
        if candidate is None:
            continue
        existing = best_by_key.get(candidate.quality_key)
        if existing is None or _stream_score(candidate) > _stream_score(existing):
            best_by_key[candidate.quality_key] = candidate

    return sorted(best_by_key.values(), key=_stream_score, reverse=True)


def _parse_stream_candidate(
    raw: Mapping[str, object],
    codec_hint: str,
) -> XiaohongshuStreamCandidate | None:
    urls = _collect_download_urls(
        _get_str(raw, "masterUrl") or _get_str(raw, "url"),
        _get_strs(raw.get("backupUrls")),
    )
    if not urls:
        return None

    stream_type = _get_int(raw, "streamType")
    quality_name = _get_str(raw, "qualityType") or _get_str(raw, "quality")
    if not quality_name and stream_type > 0:
        quality_name = f"Stream {stream_type}"
    quality_key = _build_quality_key(quality_name, stream_type)

    return XiaohongshuStreamCandidate(
        quality_key=quality_key,
        url=urls[0],
        backup_urls=urls[1:],
        size_bytes=_get_int(raw, "size"),
        width=_optional_int(raw, "width"),
        height=_optional_int(raw, "height"),
        video_codec=_get_str(raw, "videoCodec") or codec_hint,
        video_bitrate=_get_int(raw, "videoBitrate"),
        stream_type=stream_type,
        weight=_get_int(raw, "weight"),
        default_stream=_get_int(raw, "defaultStream"),
        headers=_media_headers(),
    )


def _stream_score(
    candidate: XiaohongshuStreamCandidate,
) -> tuple[int, int, int, int, int, int, int, int, int]:
    pixels = (candidate.width or 0) * (candidate.height or 0)
    return (
        1 if candidate.url.strip() else 0,
        _codec_rank(candidate.video_codec, candidate.stream_type),
        candidate.weight,
        _stream_type_rank(candidate.stream_type),
        candidate.default_stream,
        pixels,
        candidate.video_bitrate,
        candidate.size_bytes,
        len(candidate.backup_urls),
    )


def _codec_rank(codec: str, stream_type: int) -> int:
    normalized = codec.lower().replace(".", "").replace("-", "").replace("_", "").strip()
    if normalized in {"h265", "hevc"} or stream_type in {114, 115}:
        return 4
    if normalized in {"h264", "avc"} or stream_type == 259:
        return 3
    if normalized in {"av1", "h266", "vvc"}:
        return 2
    return 1


def _stream_type_rank(stream_type: int) -> int:
    if stream_type == 115:
        return 300
    if stream_type == 114:
        return 200
    if stream_type == 259:
        return 100
    return 0


def _build_quality_key(quality_name: str, stream_type: int) -> str:
    base = quality_name.strip().lower()
    if stream_type > 0:
        if not base or base.startswith("stream "):
            return f"stream_{stream_type}"
        base = re.sub(r"[\s/\\:]+", "_", base)
        return f"{base}_{stream_type}"
    return base or "default"


def _is_image_only_note(note_obj: Mapping[str, object]) -> bool:
    note_type = _get_str(note_obj, "type").lower()
    image_list = note_obj.get("imageList")
    return note_type in {"image", "album", "image_album"} or isinstance(image_list, list)


def _collect_download_urls(primary_url: str, backup_urls: list[str]) -> list[str]:
    urls: list[str] = []
    seen: set[str] = set()
    for raw_url in [primary_url, *backup_urls]:
        url = raw_url.strip()
        if not url or url in seen:
            continue
        seen.add(url)
        urls.append(url)
    return urls


def _page_headers(extra: Mapping[str, str] | None = None) -> dict[str, str]:
    headers = {
        "User-Agent": XHS_DESKTOP_USER_AGENT,
        "Referer": XHS_REFERER,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Cache-Control": "max-age=0",
    }
    if extra:
        headers.update(extra)
    return headers


def _media_headers() -> dict[str, str]:
    return {
        "User-Agent": XHS_DESKTOP_USER_AGENT,
        "Referer": XHS_REFERER,
        "Accept": "*/*",
    }


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


def _get_strs(value: object) -> list[str]:
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if isinstance(value, list):
        return [item.strip() for item in value if isinstance(item, str) and item.strip()]
    return []


def _get_int(mapping: Mapping[str, object], key: str) -> int:
    value = mapping.get(key)
    try:
        return int(value) if value is not None else 0
    except (TypeError, ValueError):
        return 0


def _optional_int(mapping: Mapping[str, object], key: str) -> int | None:
    value = _get_int(mapping, key)
    return value if value else None


def _emit_progress(progress_callback: object | None, message: str, progress: int) -> None:
    if not callable(progress_callback):
        return
    progress_callback(
        {
            "stage": "video_extracting",
            "message": message,
            "progress": progress,
        }
    )


def _emit_stream_retry(
    progress_callback: object | None,
    failed_index: int,
    candidates: list[XiaohongshuStreamCandidate],
) -> None:
    if failed_index >= len(candidates) - 1:
        return
    _emit_progress(progress_callback, "当前小红书视频流暂不可用，正在尝试备用视频流。", 30)
