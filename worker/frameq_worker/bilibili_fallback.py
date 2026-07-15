from __future__ import annotations

import gzip
import json
import os
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request
import zlib
from collections.abc import Iterator, Mapping
from dataclasses import dataclass, field
from pathlib import Path

import brotli

from frameq_worker.download_reliability import (
    SafeDownloadError,
    write_http_response_atomically,
    write_http_stream_atomically,
)
from frameq_worker.progress_events import build_worker_progress_event

BILIBILI_DESKTOP_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)
BILIBILI_BASE_URL = "https://www.bilibili.com"
BILIBILI_API_BASE_URL = "https://api.bilibili.com"
BILIBILI_REFERER = "https://www.bilibili.com/"
BILIBILI_ORIGIN = "https://www.bilibili.com"
BILIBILI_URL_PATTERN = re.compile(r"https?://[^\s\"'<>]+", re.IGNORECASE)
BILIBILI_BVID_PATTERN = re.compile(r"(?i)^BV[0-9A-Za-z]{10,}$")
BILIBILI_AVID_PATTERN = re.compile(r"(?i)^av(\d+)$")
BILIBILI_SHORT_HOSTS = {"b23.tv", "www.b23.tv"}
BILIBILI_MAX_REDIRECT_DEPTH = 5
BILIBILI_MAX_RESPONSE_BYTES = 4 * 1024 * 1024
BILIBILI_MAX_STREAM_BYTES = 2 * 1024 * 1024 * 1024
BILIBILI_DOWNLOAD_CHUNK_BYTES = 256 * 1024
BILIBILI_NO_PROGRESS_TIMEOUT_SECONDS = 120.0
BILIBILI_TRAILING_URL_PUNCTUATION = " \t\r\n\"'<>[]{}()，。！？；：、,.;:!?"
BILIBILI_CODEC_RANK = {13: 300, 12: 200, 7: 100}


class BilibiliFallbackError(RuntimeError):
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
class CommandResult:
    command: list[str]
    returncode: int
    stdout: str
    stderr: str


@dataclass(frozen=True)
class BilibiliParseResult:
    video_id: str
    id_kind: str
    part_index: int = 0
    full_url: str = ""


@dataclass(frozen=True)
class BilibiliPage:
    cid: int
    page: int
    part: str = ""
    duration_seconds: int = 0


@dataclass(frozen=True)
class BilibiliVideoInfo:
    bvid: str
    aid: int
    title: str
    pages: list[BilibiliPage] = field(default_factory=list)


@dataclass(frozen=True)
class BilibiliDashSelection:
    video_url: str
    audio_url: str
    video_backup_urls: list[str] = field(default_factory=list)
    audio_backup_urls: list[str] = field(default_factory=list)
    video_codec_id: int = 0
    quality: int = 0
    quality_name: str = ""


class UrllibBilibiliHttpClient:
    def __init__(self) -> None:
        self._opener = urllib.request.build_opener()

    def get(
        self,
        url: str,
        headers: dict[str, str] | None = None,
        timeout_seconds: float = 10.0,
    ) -> HttpResponse:
        request = urllib.request.Request(url, headers=headers or {}, method="GET")
        try:
            with self._opener.open(request, timeout=timeout_seconds) as response:
                body = response.read(BILIBILI_MAX_RESPONSE_BYTES + 1)
                return HttpResponse(
                    status=response.status,
                    headers=dict(response.headers.items()),
                    body=body,
                    url=response.geturl(),
                )
        except urllib.error.HTTPError as exc:
            return HttpResponse(
                status=exc.code,
                headers=dict(exc.headers.items()),
                body=exc.read(BILIBILI_MAX_RESPONSE_BYTES + 1),
                url=exc.geturl(),
            )
        except urllib.error.URLError as exc:
            raise BilibiliFallbackError(
                "BILIBILI_VIDEO_INFO_UNAVAILABLE",
                "Bilibili public API request failed.",
            ) from exc

    def download_to_path(
        self,
        url: str,
        destination: Path,
        *,
        headers: dict[str, str] | None = None,
        timeout_seconds: float = 30.0,
        max_bytes: int | None = None,
        no_progress_timeout_seconds: float | None = None,
    ) -> int:
        request_headers = dict(headers or {})
        resume_from = _partial_file_size(destination)
        if resume_from > 0:
            request_headers["Range"] = f"bytes={resume_from}-"
        try:
            return self._download_request_to_path(
                url,
                destination,
                headers=request_headers,
                timeout_seconds=timeout_seconds,
                max_bytes=max_bytes,
                no_progress_timeout_seconds=no_progress_timeout_seconds,
                resume_from_bytes=resume_from,
            )
        except SafeDownloadError as exc:
            if resume_from <= 0 or exc.code != "DOWNLOAD_CONTENT_RANGE_INVALID":
                raise
            destination.with_name(f"{destination.name}.part").unlink(missing_ok=True)
            return self._download_request_to_path(
                url,
                destination,
                headers=dict(headers or {}),
                timeout_seconds=timeout_seconds,
                max_bytes=max_bytes,
                no_progress_timeout_seconds=no_progress_timeout_seconds,
                resume_from_bytes=0,
            )

    def _download_request_to_path(
        self,
        url: str,
        destination: Path,
        *,
        headers: dict[str, str],
        timeout_seconds: float,
        max_bytes: int | None,
        no_progress_timeout_seconds: float | None,
        resume_from_bytes: int,
    ) -> int:
        request = urllib.request.Request(url, headers=headers, method="GET")
        try:
            with self._opener.open(request, timeout=timeout_seconds) as response:
                return write_http_stream_atomically(
                    HttpResponse(
                        status=response.status,
                        headers=dict(response.headers.items()),
                        body=b"",
                        url=response.geturl(),
                    ),
                    _response_chunks(response),
                    destination,
                    max_bytes=max_bytes,
                    no_progress_timeout_seconds=no_progress_timeout_seconds,
                    resume_from_bytes=resume_from_bytes,
                )
        except urllib.error.HTTPError as exc:
            return write_http_stream_atomically(
                HttpResponse(
                    status=exc.code,
                    headers=dict(exc.headers.items()),
                    body=b"",
                    url=exc.geturl(),
                ),
                _response_chunks(exc),
                destination,
                max_bytes=max_bytes,
                no_progress_timeout_seconds=no_progress_timeout_seconds,
                resume_from_bytes=resume_from_bytes,
            )
        except urllib.error.URLError as exc:
            raise BilibiliFallbackError(
                "BILIBILI_DASH_DOWNLOAD_FAILED",
                "Bilibili DASH media request failed.",
            ) from exc


def parse_bilibili_input(
    raw_input: str,
    http_client: UrllibBilibiliHttpClient | None = None,
) -> BilibiliParseResult:
    normalized = raw_input.strip()
    direct = _parse_direct_id(normalized)
    if direct is not None:
        return direct

    client = http_client or UrllibBilibiliHttpClient()
    last_error: BilibiliFallbackError | None = None
    for candidate_url in _extract_bilibili_urls(normalized):
        try:
            return _parse_bilibili_url_candidate(candidate_url, client, depth=0)
        except BilibiliFallbackError as exc:
            last_error = exc
            continue

    raise last_error or BilibiliFallbackError(
        "BILIBILI_ID_PARSE_FAILED",
        "Could not extract Bilibili BV or av ID from input.",
    )


def build_video_info_url(id_kind: str, video_id: str) -> str:
    query_key = "aid" if id_kind == "aid" else "bvid"
    encoded_id = urllib.parse.quote(str(video_id), safe="")
    return f"{BILIBILI_API_BASE_URL}/x/web-interface/view?{query_key}={encoded_id}"


def build_playurl_url(bvid: str, cid: int) -> str:
    encoded_bvid = urllib.parse.quote(bvid, safe="")
    return (
        f"{BILIBILI_API_BASE_URL}/x/player/playurl?"
        f"bvid={encoded_bvid}&cid={cid}&fnval=4048&fnver=0&fourk=1"
    )


def select_dash_stream_pair(
    data: Mapping[str, object],
    duration_seconds: int,
) -> BilibiliDashSelection:
    _raise_if_drm(data)
    dash = _as_mapping(data.get("dash"))
    if not dash:
        raise BilibiliFallbackError(
            "BILIBILI_NO_PLAYABLE_STREAM",
            "Bilibili playurl response did not include DASH streams.",
        )

    videos = dash.get("video")
    audios = dash.get("audio")
    if not isinstance(videos, list) or not isinstance(audios, list):
        raise BilibiliFallbackError(
            "BILIBILI_NO_PLAYABLE_STREAM",
            "Bilibili DASH response did not include video and audio streams.",
        )

    video_streams = [
        item for item in videos if isinstance(item, Mapping) and _collect_dash_urls(item)
    ]
    audio_streams = [
        item for item in audios if isinstance(item, Mapping) and _collect_dash_urls(item)
    ]
    for item in [*video_streams, *audio_streams]:
        _raise_if_drm(item)

    if not video_streams or not audio_streams:
        raise BilibiliFallbackError(
            "BILIBILI_NO_PLAYABLE_STREAM",
            "Bilibili DASH response returned no playable video/audio pair.",
        )

    best_video = max(video_streams, key=_video_stream_score)
    best_audio = max(audio_streams, key=_audio_stream_score)
    video_urls = _collect_dash_urls(best_video)
    audio_urls = _collect_dash_urls(best_audio)
    return BilibiliDashSelection(
        video_url=video_urls[0],
        audio_url=audio_urls[0],
        video_backup_urls=video_urls[1:],
        audio_backup_urls=audio_urls[1:],
        video_codec_id=_get_int(best_video, "codecid"),
        quality=_get_int(best_video, "id"),
        quality_name=_quality_name(data, _get_int(best_video, "id")),
    )


def download_bilibili_video(
    raw_input: str,
    output_dir: Path,
    command_runner: object | None = None,
    http_client: UrllibBilibiliHttpClient | None = None,
    progress_callback: object | None = None,
) -> Path:
    client = http_client or UrllibBilibiliHttpClient()
    runner = command_runner or _run_command
    parsed = parse_bilibili_input(raw_input, http_client=client)

    _emit_progress(progress_callback, "bilibili.metadata.resolving", 22)
    view_response = client.get(
        build_video_info_url(parsed.id_kind, parsed.video_id),
        headers=_api_headers(),
        timeout_seconds=10.0,
    )
    video_info = _parse_view_response(view_response)
    if not video_info.pages or parsed.part_index >= len(video_info.pages):
        raise BilibiliFallbackError(
            "BILIBILI_PART_NOT_FOUND",
            "Requested Bilibili part does not exist.",
        )
    selected_page = video_info.pages[parsed.part_index]

    _emit_progress(progress_callback, "bilibili.stream.probing", 26)
    playurl_response = client.get(
        build_playurl_url(video_info.bvid, selected_page.cid),
        headers=_api_headers(),
        timeout_seconds=10.0,
    )
    playurl_data = _parse_playurl_response(playurl_response)
    selection = select_dash_stream_pair(
        playurl_data,
        duration_seconds=selected_page.duration_seconds,
    )

    output_dir.mkdir(parents=True, exist_ok=True)
    stem = (
        video_info.bvid
        if selected_page.page <= 1
        else f"{video_info.bvid}_p{selected_page.page}"
    )
    output_path = output_dir / f"{stem}.mp4"
    video_temp_path = output_dir / f"{stem}_video.m4s"
    audio_temp_path = output_dir / f"{stem}_audio.m4s"
    merge_temp_path = output_dir / f"{stem}.merge.mp4"

    try:
        _emit_progress(progress_callback, "bilibili.video.downloading", 30)
        _download_first_available_url(
            [selection.video_url, *selection.video_backup_urls],
            video_temp_path,
            client,
        )
        _emit_progress(progress_callback, "bilibili.audio.downloading", 32)
        _download_first_available_url(
            [selection.audio_url, *selection.audio_backup_urls],
            audio_temp_path,
            client,
        )
        _emit_progress(progress_callback, "bilibili.media.merging", 34)
        _merge_dash_files(video_temp_path, audio_temp_path, merge_temp_path, runner)
        os.replace(merge_temp_path, output_path)
    except BilibiliFallbackError:
        raise
    finally:
        merge_temp_path.unlink(missing_ok=True)
        video_temp_path.with_name(f"{video_temp_path.name}.part").unlink(missing_ok=True)
        audio_temp_path.with_name(f"{audio_temp_path.name}.part").unlink(missing_ok=True)
    video_temp_path.unlink(missing_ok=True)
    audio_temp_path.unlink(missing_ok=True)
    return output_path


def _parse_direct_id(value: str) -> BilibiliParseResult | None:
    if BILIBILI_BVID_PATTERN.fullmatch(value):
        return BilibiliParseResult(video_id=value, id_kind="bvid")
    avid = BILIBILI_AVID_PATTERN.fullmatch(value)
    if avid:
        return BilibiliParseResult(video_id=avid.group(1), id_kind="aid")
    return None


def _parse_bilibili_url_candidate(
    raw_url: str,
    http_client: UrllibBilibiliHttpClient,
    *,
    depth: int,
) -> BilibiliParseResult:
    if depth > BILIBILI_MAX_REDIRECT_DEPTH:
        raise BilibiliFallbackError(
            "BILIBILI_SHORT_LINK_RESOLVE_FAILED",
            "Bilibili short link redirected too many times.",
        )

    parsed = _parse_bilibili_video_url(raw_url)
    if parsed is not None:
        return parsed
    if not _is_bilibili_short_link(raw_url):
        raise BilibiliFallbackError(
            "BILIBILI_ID_PARSE_FAILED",
            "Could not extract Bilibili BV or av ID from URL.",
        )

    resolved_url = _resolve_short_link(raw_url, http_client)
    return _parse_bilibili_url_candidate(resolved_url, http_client, depth=depth + 1)


def _parse_bilibili_video_url(raw_url: str) -> BilibiliParseResult | None:
    raw_url = raw_url.strip().strip("\"'<>[]{}()")
    parsed = urllib.parse.urlparse(raw_url)
    if parsed.scheme.lower() not in {"http", "https"}:
        raise BilibiliFallbackError(
            "BILIBILI_ID_PARSE_FAILED",
            "Bilibili URL must use http or https.",
        )

    host = (parsed.hostname or "").lower().rstrip(".")
    if _is_bilibili_short_host(host):
        return None
    if not _is_bilibili_host(host):
        raise BilibiliFallbackError("BILIBILI_ID_PARSE_FAILED", "Unsupported Bilibili host.")

    lowered_path = parsed.path.lower()
    if any(
        lowered_path.startswith(prefix)
        for prefix in (
            "/bangumi/",
            "/movie/",
            "/cheese/",
            "/festival/",
        )
    ):
        raise BilibiliFallbackError(
            "BILIBILI_UNSUPPORTED_CONTENT",
            "Only ordinary public Bilibili videos are supported.",
        )

    segments = [segment for segment in parsed.path.split("/") if segment]
    if len(segments) < 2 or segments[0].lower() != "video":
        raise BilibiliFallbackError(
            "BILIBILI_ID_PARSE_FAILED",
            "Could not extract Bilibili BV or av ID from URL.",
        )

    video_segment = segments[1]
    direct = _parse_direct_id(video_segment)
    if direct is None:
        raise BilibiliFallbackError(
            "BILIBILI_ID_PARSE_FAILED",
            "Could not extract Bilibili BV or av ID from URL.",
        )

    query = urllib.parse.parse_qs(parsed.query)
    part_index = _parse_part_index(query.get("p", ["1"])[0])
    return BilibiliParseResult(
        video_id=direct.video_id,
        id_kind=direct.id_kind,
        part_index=part_index,
        full_url=parsed.geturl(),
    )


def _parse_part_index(value: object) -> int:
    try:
        page = int(value)
    except (TypeError, ValueError):
        page = 1
    return max(0, page - 1)


def _resolve_short_link(
    short_url: str,
    http_client: UrllibBilibiliHttpClient,
) -> str:
    last_error: Exception | None = None
    for attempt_url in _short_link_attempts(short_url):
        try:
            return _resolve_short_link_once(attempt_url, http_client)
        except (SafeDownloadError, BilibiliFallbackError, OSError) as exc:
            last_error = exc
            continue
    raise BilibiliFallbackError(
        "BILIBILI_SHORT_LINK_RESOLVE_FAILED",
        "Bilibili short link could not be resolved.",
    ) from last_error


def _resolve_short_link_once(
    short_url: str,
    http_client: UrllibBilibiliHttpClient,
) -> str:
    response = http_client.get(short_url, headers=_page_headers(), timeout_seconds=10.0)
    location = _header(response.headers, "Location")
    if 300 <= response.status < 400 and location:
        return urllib.parse.urljoin(response.url or short_url, location.strip())

    if _parse_bilibili_video_url(response.url) is not None:
        return response.url

    body = _decode_response_body(response, max_bytes=256 * 1024)
    for embedded_url in _extract_bilibili_urls(body):
        if _parse_bilibili_video_url(embedded_url) is not None:
            return embedded_url

    raise BilibiliFallbackError(
        "BILIBILI_SHORT_LINK_RESOLVE_FAILED",
        "Bilibili short link response did not contain an ordinary video URL.",
    )


def _short_link_attempts(short_url: str) -> list[str]:
    attempts = [short_url]
    parsed = urllib.parse.urlparse(short_url)
    if parsed.scheme.lower() == "http":
        secure_url = parsed._replace(scheme="https").geturl()
        if secure_url not in attempts:
            attempts.append(secure_url)
    return attempts


def _extract_bilibili_urls(raw_input: str) -> list[str]:
    urls: list[str] = []
    for match in BILIBILI_URL_PATTERN.finditer(raw_input):
        candidate = match.group(0).rstrip(BILIBILI_TRAILING_URL_PUNCTUATION)
        parsed = urllib.parse.urlparse(candidate)
        if _is_acceptable_bilibili_host(parsed.hostname or ""):
            urls.append(candidate)
    return urls


def _is_bilibili_short_link(url: str) -> bool:
    parsed = urllib.parse.urlparse(url)
    return _is_bilibili_short_host(parsed.hostname or "")


def _is_bilibili_short_host(host: str) -> bool:
    return host.lower().rstrip(".") in BILIBILI_SHORT_HOSTS


def _is_acceptable_bilibili_host(host: str) -> bool:
    normalized = host.lower().rstrip(".")
    return _is_bilibili_host(normalized) or _is_bilibili_short_host(normalized)


def _is_bilibili_host(host: str) -> bool:
    normalized = host.lower().rstrip(".")
    return normalized == "bilibili.com" or normalized.endswith(".bilibili.com")


def _parse_view_response(response: HttpResponse) -> BilibiliVideoInfo:
    payload = _json_response(response, unavailable_code="BILIBILI_VIDEO_INFO_UNAVAILABLE")
    data = _api_data(payload, unavailable_code="BILIBILI_VIDEO_INFO_UNAVAILABLE")
    if not isinstance(data, Mapping):
        raise BilibiliFallbackError(
            "BILIBILI_VIDEO_INFO_UNAVAILABLE",
            "Bilibili video information response was malformed.",
        )

    bvid = _get_str(data, "bvid")
    aid = _get_int(data, "aid")
    pages_obj = data.get("pages")
    pages: list[BilibiliPage] = []
    if isinstance(pages_obj, list):
        for raw_page in pages_obj:
            if not isinstance(raw_page, Mapping):
                continue
            cid = _get_int(raw_page, "cid")
            if cid <= 0:
                continue
            pages.append(
                BilibiliPage(
                    cid=cid,
                    page=_get_int(raw_page, "page") or len(pages) + 1,
                    part=_get_str(raw_page, "part"),
                    duration_seconds=_get_int(raw_page, "duration"),
                )
            )
    if not bvid or aid <= 0 or not pages:
        raise BilibiliFallbackError(
            "BILIBILI_VIDEO_INFO_UNAVAILABLE",
            "Bilibili video information was incomplete.",
        )
    return BilibiliVideoInfo(
        bvid=bvid,
        aid=aid,
        title=_get_str(data, "title"),
        pages=pages,
    )


def _parse_playurl_response(response: HttpResponse) -> Mapping[str, object]:
    payload = _json_response(response, unavailable_code="BILIBILI_NO_PLAYABLE_STREAM")
    data = _api_data(payload, unavailable_code="BILIBILI_NO_PLAYABLE_STREAM")
    if not isinstance(data, Mapping):
        raise BilibiliFallbackError(
            "BILIBILI_NO_PLAYABLE_STREAM",
            "Bilibili playurl response was malformed.",
        )
    return data


def _json_response(response: HttpResponse, *, unavailable_code: str) -> Mapping[str, object]:
    if response.status in {401, 403}:
        raise BilibiliFallbackError(
            "BILIBILI_LOGIN_REQUIRED",
            "Bilibili video requires login or account authorization.",
        )
    if response.status < 200 or response.status >= 300 or not response.body:
        raise BilibiliFallbackError(unavailable_code, "Bilibili API response was unavailable.")

    body = _decode_response_body(response)
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise BilibiliFallbackError(
            unavailable_code,
            "Bilibili API response was not JSON.",
        ) from exc
    if not isinstance(payload, Mapping):
        raise BilibiliFallbackError(unavailable_code, "Bilibili API response was malformed.")
    return payload


def _api_data(payload: Mapping[str, object], *, unavailable_code: str) -> object:
    code = _get_int(payload, "code")
    if code != 0:
        message = _get_str(payload, "message") or _get_str(payload, "msg")
        lowered = message.lower()
        if code in {-101, -102, -104, -404, -403} or any(
            marker in lowered for marker in ("login", "登录", "权限", "会员", "vip")
        ):
            raise BilibiliFallbackError(
                "BILIBILI_LOGIN_REQUIRED",
                "Bilibili video requires login or account authorization.",
            )
        raise BilibiliFallbackError(unavailable_code, "Bilibili API returned an error.")
    return payload.get("data")


def _download_first_available_url(
    urls: list[str],
    output_path: Path,
    http_client: UrllibBilibiliHttpClient,
) -> Path:
    last_error: Exception | None = None
    for url in urls:
        try:
            _download_url_to_path(url, output_path, http_client)
        except (SafeDownloadError, BilibiliFallbackError, OSError) as exc:
            last_error = exc
            continue
        return output_path

    raise BilibiliFallbackError(
        "BILIBILI_DASH_DOWNLOAD_FAILED",
        "All Bilibili DASH media URLs failed to download.",
    ) from last_error


def _download_url_to_path(
    url: str,
    output_path: Path,
    http_client: UrllibBilibiliHttpClient,
) -> int:
    downloader = getattr(http_client, "download_to_path", None)
    if callable(downloader):
        return int(
            downloader(
                url,
                output_path,
                headers=_media_headers(),
                timeout_seconds=30.0,
                max_bytes=BILIBILI_MAX_STREAM_BYTES,
                no_progress_timeout_seconds=BILIBILI_NO_PROGRESS_TIMEOUT_SECONDS,
            )
        )

    response = http_client.get(
        url,
        headers=_media_headers(),
        timeout_seconds=30.0,
    )
    return write_http_response_atomically(
        response,
        output_path,
        max_bytes=BILIBILI_MAX_STREAM_BYTES,
    )


def _merge_dash_files(
    video_path: Path,
    audio_path: Path,
    output_path: Path,
    command_runner: object,
) -> None:
    command = [
        "ffmpeg",
        "-y",
        "-i",
        video_path.as_posix(),
        "-i",
        audio_path.as_posix(),
        "-c",
        "copy",
        output_path.as_posix(),
    ]
    result = command_runner(command) if callable(command_runner) else _run_command(command)
    if getattr(result, "returncode", 1) != 0:
        raise BilibiliFallbackError(
            "BILIBILI_FFMPEG_MERGE_FAILED",
            "ffmpeg exited with a non-zero status while merging Bilibili DASH streams.",
        )
    if not output_path.is_file() or output_path.stat().st_size <= 0:
        raise BilibiliFallbackError(
            "BILIBILI_FFMPEG_MERGE_FAILED",
            "ffmpeg did not produce a merged Bilibili MP4.",
        )


def _run_command(command: list[str]) -> CommandResult:
    completed = subprocess.run(command, capture_output=True, check=False, text=True)
    return CommandResult(
        command=command,
        returncode=completed.returncode,
        stdout=completed.stdout,
        stderr=completed.stderr,
    )


def _video_stream_score(item: Mapping[str, object]) -> tuple[int, int, int, int, int]:
    codecid = _get_int(item, "codecid")
    pixels = _get_int(item, "width") * _get_int(item, "height")
    return (
        BILIBILI_CODEC_RANK.get(codecid, 0),
        _get_int(item, "bandwidth"),
        pixels,
        _get_int(item, "id"),
        len(_collect_dash_urls(item)),
    )


def _audio_stream_score(item: Mapping[str, object]) -> tuple[int, int, int]:
    return (
        _get_int(item, "bandwidth"),
        _get_int(item, "id"),
        len(_collect_dash_urls(item)),
    )


def _collect_dash_urls(item: Mapping[str, object]) -> list[str]:
    primary = _get_str(item, "baseUrl") or _get_str(item, "base_url")
    backups = _get_strs(item.get("backupUrl")) + _get_strs(item.get("backup_url"))
    return _collect_download_urls(primary, backups)


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


def _raise_if_drm(item: Mapping[str, object]) -> None:
    if _get_int(item, "drm_tech_type") > 0 or _get_str(item, "bilidrm_uri"):
        raise BilibiliFallbackError(
            "BILIBILI_DRM_PROTECTED",
            "Selected Bilibili DASH stream is DRM protected.",
        )


def _quality_name(data: Mapping[str, object], quality_id: int) -> str:
    formats = data.get("support_formats")
    if isinstance(formats, list):
        for item in formats:
            if not isinstance(item, Mapping) or _get_int(item, "quality") != quality_id:
                continue
            return (
                _get_str(item, "new_description")
                or _get_str(item, "display_desc")
                or _get_str(item, "description")
            )
    return ""


def _decode_response_body(
    response: HttpResponse,
    max_bytes: int = BILIBILI_MAX_RESPONSE_BYTES,
) -> str:
    body = response.body
    if len(body) > max_bytes:
        raise BilibiliFallbackError(
            "BILIBILI_VIDEO_INFO_UNAVAILABLE",
            "Bilibili response exceeded the safety limit.",
        )
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
        raise BilibiliFallbackError(
            "BILIBILI_VIDEO_INFO_UNAVAILABLE",
            "Bilibili response body could not be decoded.",
        ) from exc
    return body.decode("utf-8", errors="replace")


def _response_chunks(response: object) -> Iterator[bytes]:
    while True:
        chunk = response.read(BILIBILI_DOWNLOAD_CHUNK_BYTES)
        if not chunk:
            break
        yield chunk


def _partial_file_size(destination: Path) -> int:
    part_path = destination.with_name(f"{destination.name}.part")
    try:
        return part_path.stat().st_size if part_path.is_file() else 0
    except OSError:
        return 0


def _page_headers(extra: Mapping[str, str] | None = None) -> dict[str, str]:
    headers = {
        "User-Agent": BILIBILI_DESKTOP_USER_AGENT,
        "Referer": BILIBILI_REFERER,
        "Accept": (
            "text/html,application/xhtml+xml,application/xml;q=0.9,"
            "image/avif,image/webp,image/apng,*/*;q=0.8"
        ),
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
    }
    if extra:
        headers.update(extra)
    return headers


def _api_headers(extra: Mapping[str, str] | None = None) -> dict[str, str]:
    headers = {
        "User-Agent": BILIBILI_DESKTOP_USER_AGENT,
        "Referer": BILIBILI_REFERER,
        "Origin": BILIBILI_ORIGIN,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
    }
    if extra:
        headers.update(extra)
    return headers


def _media_headers() -> dict[str, str]:
    return {
        "User-Agent": BILIBILI_DESKTOP_USER_AGENT,
        "Referer": BILIBILI_REFERER,
        "Origin": BILIBILI_ORIGIN,
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


def _emit_progress(
    progress_callback: object | None,
    message_code: str,
    progress: int,
) -> None:
    event = build_worker_progress_event(
        message_code,
        stage="video_extracting",
        progress=progress,
    )
    if not callable(progress_callback):
        return
    progress_callback(event)
