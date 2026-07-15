import json
from pathlib import Path

import pytest
from frameq_worker.bilibili_fallback import (
    BilibiliFallbackError,
    HttpResponse,
    build_playurl_url,
    build_video_info_url,
    download_bilibili_video,
    parse_bilibili_input,
    select_dash_stream_pair,
)
from frameq_worker.media import CommandResult

BVID = "BV1Aa411c7mD"
AID = 170001
CID_1 = 111111
CID_2 = 222222


class FakeBilibiliHttpClient:
    def __init__(
        self,
        responses: dict[str, list[HttpResponse | Exception]] | None = None,
        downloads: dict[str, list[bytes | Exception]] | None = None,
    ) -> None:
        self.responses = {url: list(items) for url, items in (responses or {}).items()}
        self.downloads = {url: list(items) for url, items in (downloads or {}).items()}
        self.calls: list[tuple[str, dict[str, str]]] = []
        self.download_calls: list[tuple[str, Path, dict[str, str]]] = []

    def get(
        self,
        url: str,
        headers: dict[str, str] | None = None,
        timeout_seconds: float = 10.0,
    ) -> HttpResponse:
        self.calls.append((url, headers or {}))
        items = self.responses.get(url)
        if not items:
            raise AssertionError(f"Unexpected URL: {url}")
        item = items.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

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
        self.download_calls.append((url, destination, headers or {}))
        items = self.downloads.get(url)
        if not items:
            raise AssertionError(f"Unexpected download URL: {url}")
        item = items.pop(0)
        if isinstance(item, Exception):
            raise item
        destination.write_bytes(item)
        return len(item)


def ok_response(url: str, payload: dict[str, object]) -> HttpResponse:
    return HttpResponse(
        status=200,
        headers={"Content-Type": "application/json"},
        body=json.dumps(payload).encode(),
        url=url,
    )


def view_payload() -> dict[str, object]:
    return {
        "code": 0,
        "message": "0",
        "data": {
            "bvid": BVID,
            "aid": AID,
            "title": "demo title",
            "duration": 120,
            "owner": {"name": "demo author"},
            "pages": [
                {"cid": CID_1, "page": 1, "part": "P1", "duration": 60},
                {"cid": CID_2, "page": 2, "part": "P2", "duration": 60},
            ],
        },
    }


def playurl_payload(extra: dict[str, object] | None = None) -> dict[str, object]:
    data: dict[str, object] = {
        "quality": 80,
        "accept_quality": [80, 64],
        "accept_description": ["1080P", "720P"],
        "support_formats": [{"quality": 80, "new_description": "1080P"}],
        "dash": {
            "video": [
                {
                    "id": 80,
                    "baseUrl": "https://cdn.example/h264.m4s",
                    "backupUrl": ["https://cdn.example/h264-backup.m4s"],
                    "bandwidth": 2_000_000,
                    "codecid": 7,
                    "codecs": "avc1",
                    "width": 1920,
                    "height": 1080,
                    "frameRate": "30.000",
                    "mimeType": "video/mp4",
                },
                {
                    "id": 80,
                    "baseUrl": "https://cdn.example/h265.m4s",
                    "bandwidth": 1_800_000,
                    "codecid": 12,
                    "codecs": "hev1",
                    "width": 1920,
                    "height": 1080,
                    "frame_rate": "30.000",
                    "mime_type": "video/mp4",
                },
                {
                    "id": 64,
                    "base_url": "https://cdn.example/av1.m4s",
                    "bandwidth": 1_200_000,
                    "codecid": 13,
                    "codecs": "av01",
                    "width": 1280,
                    "height": 720,
                },
            ],
            "audio": [
                {
                    "id": 30216,
                    "baseUrl": "https://cdn.example/audio-low.m4s",
                    "bandwidth": 64_000,
                },
                {
                    "id": 30280,
                    "base_url": "https://cdn.example/audio-high.m4s",
                    "backup_url": ["https://cdn.example/audio-high-backup.m4s"],
                    "bandwidth": 128_000,
                },
            ],
        },
    }
    if extra:
        data.update(extra)
    return {"code": 0, "message": "0", "data": data}


def test_parse_bilibili_input_accepts_bv_av_part_and_short_link() -> None:
    client = FakeBilibiliHttpClient(
        {
            "https://b23.tv/demo": [
                HttpResponse(
                    status=302,
                    headers={"Location": f"https://www.bilibili.com/video/{BVID}?p=2"},
                    body=b"",
                    url="https://b23.tv/demo",
                )
            ]
        }
    )

    bv = parse_bilibili_input(f"https://www.bilibili.com/video/{BVID}?p=2")
    av = parse_bilibili_input("https://www.bilibili.com/video/av170001")
    short = parse_bilibili_input("copy https://b23.tv/demo", http_client=client)

    assert bv.video_id == BVID
    assert bv.id_kind == "bvid"
    assert bv.part_index == 1
    assert av.video_id == "170001"
    assert av.id_kind == "aid"
    assert av.part_index == 0
    assert short.video_id == BVID
    assert short.part_index == 1


def test_parse_bilibili_input_rejects_bangumi_as_unsupported_content() -> None:
    with pytest.raises(BilibiliFallbackError) as exc_info:
        parse_bilibili_input("https://www.bilibili.com/bangumi/play/ep123456")

    assert exc_info.value.code == "BILIBILI_UNSUPPORTED_CONTENT"


def test_select_dash_stream_pair_prefers_codec_and_best_audio() -> None:
    selection = select_dash_stream_pair(playurl_payload()["data"], duration_seconds=60)

    assert selection.video_url == "https://cdn.example/av1.m4s"
    assert selection.video_codec_id == 13
    assert selection.audio_url == "https://cdn.example/audio-high.m4s"
    assert selection.audio_backup_urls == ["https://cdn.example/audio-high-backup.m4s"]


def test_select_dash_stream_pair_promotes_backup_when_primary_missing() -> None:
    payload = {
        "dash": {
            "video": [
                {
                    "id": 80,
                    "baseUrl": "",
                    "backupUrl": ["https://cdn.example/video-backup.m4s"],
                    "bandwidth": 1_000_000,
                    "codecid": 7,
                }
            ],
            "audio": [
                {
                    "id": 30280,
                    "base_url": "",
                    "backup_url": ["https://cdn.example/audio-backup.m4s"],
                    "bandwidth": 128_000,
                }
            ],
        }
    }

    selection = select_dash_stream_pair(payload, duration_seconds=30)

    assert selection.video_url == "https://cdn.example/video-backup.m4s"
    assert selection.audio_url == "https://cdn.example/audio-backup.m4s"


def test_download_bilibili_video_downloads_dash_and_merges_selected_part(
    tmp_path: Path,
) -> None:
    view_url = build_video_info_url("bvid", BVID)
    playurl_url = build_playurl_url(BVID, CID_2)
    client = FakeBilibiliHttpClient(
        responses={
            view_url: [ok_response(view_url, view_payload())],
            playurl_url: [ok_response(playurl_url, playurl_payload())],
        },
        downloads={
            "https://cdn.example/av1.m4s": [OSError("cdn failed")],
            "https://cdn.example/audio-high.m4s": [b"audio bytes"],
        },
    )
    commands: list[list[str]] = []

    def fake_runner(command: list[str]) -> CommandResult:
        commands.append(command)
        if command[0] == "ffmpeg":
            Path(command[-1]).write_bytes(b"merged mp4")
            return CommandResult(command=command, returncode=0, stdout="", stderr="")
        raise AssertionError(f"Unexpected command: {command}")

    with pytest.raises(BilibiliFallbackError) as exc_info:
        download_bilibili_video(
            f"https://www.bilibili.com/video/{BVID}?p=2",
            output_dir=tmp_path,
            command_runner=fake_runner,
            http_client=client,
        )

    assert exc_info.value.code == "BILIBILI_DASH_DOWNLOAD_FAILED"

    client = FakeBilibiliHttpClient(
        responses={
            view_url: [ok_response(view_url, view_payload())],
            playurl_url: [ok_response(playurl_url, playurl_payload())],
        },
        downloads={
            "https://cdn.example/av1.m4s": [b"video bytes"],
            "https://cdn.example/audio-high.m4s": [b"audio bytes"],
        },
    )
    events: list[dict[str, object]] = []
    path = download_bilibili_video(
        f"https://www.bilibili.com/video/{BVID}?p=2",
        output_dir=tmp_path,
        command_runner=fake_runner,
        http_client=client,
        progress_callback=events.append,
    )

    assert path == tmp_path / f"{BVID}_p2.mp4"
    assert path.read_bytes() == b"merged mp4"
    assert commands[-1] == [
        "ffmpeg",
        "-y",
        "-i",
        (tmp_path / f"{BVID}_p2_video.m4s").as_posix(),
        "-i",
        (tmp_path / f"{BVID}_p2_audio.m4s").as_posix(),
        "-c",
        "copy",
        (tmp_path / f"{BVID}_p2.merge.mp4").as_posix(),
    ]
    assert not (tmp_path / f"{BVID}_p2_video.m4s").exists()
    assert not (tmp_path / f"{BVID}_p2_audio.m4s").exists()
    assert events == [
        {
            "stage": "video_extracting",
            "progress": 22,
            "message_code": "bilibili.metadata.resolving",
        },
        {
            "stage": "video_extracting",
            "progress": 26,
            "message_code": "bilibili.stream.probing",
        },
        {
            "stage": "video_extracting",
            "progress": 30,
            "message_code": "bilibili.video.downloading",
        },
        {
            "stage": "video_extracting",
            "progress": 32,
            "message_code": "bilibili.audio.downloading",
        },
        {
            "stage": "video_extracting",
            "progress": 34,
            "message_code": "bilibili.media.merging",
        },
    ]
    assert all("message" not in event for event in events)


def test_download_bilibili_video_rejects_drm_and_missing_part(tmp_path: Path) -> None:
    view_url = build_video_info_url("bvid", BVID)
    missing_client = FakeBilibiliHttpClient({view_url: [ok_response(view_url, view_payload())]})

    with pytest.raises(BilibiliFallbackError) as part_exc:
        download_bilibili_video(
            f"https://www.bilibili.com/video/{BVID}?p=3",
            output_dir=tmp_path,
            command_runner=lambda command: CommandResult(command, 0, "", ""),
            http_client=missing_client,
        )

    assert part_exc.value.code == "BILIBILI_PART_NOT_FOUND"

    drm_payload = playurl_payload(
        {
            "drm_tech_type": 2,
        }
    )
    drm_client = FakeBilibiliHttpClient(
        {
            view_url: [ok_response(view_url, view_payload())],
            build_playurl_url(BVID, CID_1): [
                ok_response(build_playurl_url(BVID, CID_1), drm_payload)
            ],
        }
    )

    with pytest.raises(BilibiliFallbackError) as drm_exc:
        download_bilibili_video(
            f"https://www.bilibili.com/video/{BVID}",
            output_dir=tmp_path,
            command_runner=lambda command: CommandResult(command, 0, "", ""),
            http_client=drm_client,
        )

    assert drm_exc.value.code == "BILIBILI_DRM_PROTECTED"
