from __future__ import annotations

import json
import os
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from pathlib import Path

from worker_core.desktop_contract import ProgressCallback
from worker_core.models import JobStage, ProcessResult, WorkerError
from worker_core.progress_events import build_worker_progress_event
from worker_core.task_store import (
    TASK_MANIFEST_FILE_NAME,
    TaskStoreFacade,
    result_with_task,
    serialize_task_manifest,
)
from worker_core.task_transaction import commit_task_artifacts
from worker_core.web_page_contract import (
    MAX_ARTICLE_MARKDOWN_BYTES,
    WebPageSource,
    parse_web_page_request,
    validate_article_payload,
)


def save_web_page(
    store: TaskStoreFacade,
    payload: object,
    *,
    task_id: str | None = None,
    now: datetime | None = None,
    _fault_hook: Callable[[str], None] | None = None,
) -> ProcessResult:
    article = validate_article_payload(payload)
    extracted_at = (
        (now or datetime.now(UTC)).astimezone(UTC)
        .isoformat(timespec="seconds").replace("+00:00", "Z")
    )
    source = WebPageSource(article["sourceUrl"], article["title"], extracted_at)
    # 标题按Markdown标点转义，来源与时间只接受已验证的本机字段。
    safe_title = source.title.translate(str.maketrans({
        char: "\\" + char for char in "\\`*_{}[]<>()#+-.!|"
    }))
    markdown = f"# {safe_title}\n\n<{source.url}>\n\n{extracted_at}\n\n{article['markdown']}"
    if len(markdown.encode("utf-8")) > MAX_ARTICLE_MARKDOWN_BYTES:
        raise ValueError("Saved web page Markdown exceeds its limit.")
    context = store.create_web(source, now=now, task_id=task_id)
    result = ProcessResult(
        status=JobStage.COMPLETED, task_id=context.task_id,
        task_dir=context.paths.task_dir.as_posix(),
        text=article["text"], markdown=markdown, source=source, task_created=True,
        artifacts={"article_txt": "article/article.txt", "article_md": "article/article.md"},
    )
    commit_task_artifacts(context.paths.task_dir, {
        "article/article.txt": article["text"].encode("utf-8"),
        "article/article.md": markdown.encode("utf-8"),
        TASK_MANIFEST_FILE_NAME: serialize_task_manifest(context, result),
    }, _fault_hook=_fault_hook)
    return result_with_task(result, context)


def save_web_page_once(
    request_json: str, *, environ: Mapping[str, str] | None = None,
    progress_callback: ProgressCallback | None = None,
) -> dict[str, object]:
    env = os.environ if environ is None else environ
    try:
        request = parse_web_page_request(json.loads(request_json))
        output_root, cache_root = Path(env["APP_OUTPUT_DIR"]), Path(env["APP_CACHE_DIR"])
        if not output_root.is_absolute() or not cache_root.is_absolute():
            raise ValueError("Web page storage is invalid.")
        if progress_callback is not None:
            progress_callback(build_worker_progress_event(
                "web.page.saving", stage=JobStage.WEB_SAVING.value, progress=90,
            ))
        return save_web_page(
            TaskStoreFacade(output_root, cache_root), request.article, task_id=request.task_id,
        ).to_dict()
    except (ValueError, KeyError, OSError):
        return ProcessResult(status=JobStage.FAILED, error=WorkerError(
            code="WEB_PAGE_REQUEST_OR_STORAGE_INVALID", message="Web page saving failed.",
            stage=JobStage.WEB_SAVING,
        )).to_dict()
